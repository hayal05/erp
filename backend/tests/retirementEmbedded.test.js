import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/retirement';
const db=new PGlite({extensions:{btree_gist}}),q=(sql,args)=>db.query(sql,args);
const {pool}=await import('../src/db/pool.js');pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{hashPassword}=await import('../src/services/password.js'),{signIn}=await import('./hrClient.js');
const {loadRetirement}=await import('../src/services/retirement.js');
const {default:request}=await import('supertest');
const password='password-123';let root,admin,hr,hr2,finance,employee,shift;
async function person(username,dob,{role=null,status='active',start='2020-01-01'}={}){
 const user=(await q("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$1,$2,'employee') RETURNING id",[username,await hashPassword(password)])).rows[0].id;
 await q('INSERT INTO employees(employee_code,user_id,date_of_birth,start_date,shift_id,status) VALUES($1,$2,$3,$4,$5,$6)',[username,user,dob,start,shift,status]);
 if(role)await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[user,role,root]);
 return signIn(app,{username,password});
}
const list=extra=>loadRetirement(db,{page:1,pageSize:25,employmentStatus:'all',...extra},{today:'2026-11-04'});
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 for(const file of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(file,dir),'utf8'));
 root=(await seedAdmin({username:'root',password})).id;admin=await signIn(app,{username:'root',password});
 shift=(await q("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','08:00','17:00') RETURNING id")).rows[0].id;
 hr=await person('hr.retire','1990-01-01',{role:'hr'});hr2=await person('review.retire','1990-01-01',{role:'hr'});
 finance=await person('finance.retire','1990-01-01',{role:'finance'});employee=await person('employee.retire','1990-01-01');
 await person('exact','1966-11-04');await person('tomorrow','1966-11-05');await person('yesterday','1966-11-03',{status:'inactive'});
 await person('missing',null);await person('leap','1968-02-29');await person('future','2000-01-01',{start:'2027-01-01'});
});
after(()=>db.close());
test('retirement starts unconfigured, keeps ages and handles missing DOB without inventing retirement dates',async()=>{
 const d=await list();assert.equal(d.settings.retirementAge,null);
 const exact=d.items.find(e=>e.employeeCode==='exact');assert.equal(exact.age,60);assert.equal(exact.retirementDate,null);assert.equal(exact.status,'not_configured');
 const missing=d.items.find(e=>e.employeeCode==='missing');assert.equal(missing.age,null);assert.equal(missing.status,'missing_birth_date');
});
test('only management can read, only HR/Admin can change age; invalid settings are rejected',async()=>{
 assert.equal((await request(app).get('/api/retirement')).status,401);
 assert.equal((await employee.get('/api/retirement')).status,403);
 assert.equal((await hr.get('/api/retirement')).status,200);assert.equal((await finance.get('/api/retirement')).status,200);
 assert.equal((await finance.put('/api/retirement/settings').send({retirementAge:60,version:1})).status,403);
 for(const body of [{retirementAge:17,version:1},{retirementAge:101,version:1},{retirementAge:60.5,version:1},{retirementAge:null,version:1},{retirementAge:60},{version:1}])assert.equal((await admin.put('/api/retirement/settings').send(body)).status,400,JSON.stringify(body));
 const r=await admin.put('/api/retirement/settings').send({retirementAge:60,version:1});assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,{retirementAge:60,version:2});
 const logs=(await q("SELECT details FROM audit_logs WHERE entity_type='retirement_settings'")).rows;assert.deepEqual(logs[0].details.changes.retirementAge,{from:null,to:60});
 assert.equal((await admin.put('/api/retirement/settings').send({retirementAge:61,version:1})).status,409);
});
test('calculates exact birthday, next birthday, overdue and leap date with stable pagination and filters',async()=>{
 const d=await list();const by=code=>d.items.find(e=>e.employeeCode===code);
 assert.deepEqual([by('exact').age,by('exact').retirementDate,by('exact').daysRemaining,by('exact').status],[60,'2026-11-04',0,'reached']);
 assert.deepEqual([by('tomorrow').age,by('tomorrow').daysRemaining,by('tomorrow').status],[59,1,'within_year']);
 assert.deepEqual([by('yesterday').daysRemaining,by('yesterday').employmentStatus],[-1,'inactive']);
 assert.equal(by('leap').retirementDate,'2028-02-29');assert.equal(by('future').age,26);
 assert.equal((await list({status:'reached'})).total,2);
 assert.equal((await list({employmentStatus:'active',status:'reached'})).total,1);
 assert.equal((await list({search:'tomorrow'})).total,1);assert.equal((await list({search:'%'})).total,0);
 const first=await list({pageSize:2}),second=await list({pageSize:2,page:2});assert.equal(first.total,10);assert.equal(new Set([...first.items,...second.items].map(e=>e.id)).size,4);
 const empty=await list({page:20,pageSize:2});assert.equal(empty.items.length,0);assert.equal(empty.total,10);
 const leap=await loadRetirement(db,{page:1,pageSize:25,employmentStatus:'all',search:'leap'},{today:'2027-02-28'});assert.equal(leap.items[0].age,59);
 await q('UPDATE retirement_settings SET retirement_age=59 WHERE id=1');
 const leapReached=await loadRetirement(db,{page:1,pageSize:25,employmentStatus:'all',search:'leap'},{today:'2027-02-28'});assert.equal(leapReached.items[0].retirementDate,'2027-02-28');assert.equal(leapReached.items[0].status,'reached');
 await q('UPDATE retirement_settings SET retirement_age=60 WHERE id=1');
});
test('HR changes wait for another HR reviewer or Admin; audit footer records approval and no employment record changes',async()=>{
 const before=(await q('SELECT id,status FROM employees ORDER BY id')).rows;
 const pending=await hr.put('/api/retirement/settings').send({retirementAge:62,version:2});assert.equal(pending.status,202,JSON.stringify(pending.body));
 assert.equal((await admin.get('/api/retirement')).body.settings.retirementAge,60);
 assert.equal((await hr.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status,403);
 assert.equal((await finance.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status,403);
 const approved=await hr2.post(`/api/change-requests/${pending.body.requestId}/approve`).send({});assert.equal(approved.status,200,JSON.stringify(approved.body));
 assert.deepEqual((await admin.get('/api/retirement')).body.settings,{retirementAge:62,version:3});
 const audit=await hr.get('/api/audit-history?area=retirement');assert.equal(audit.status,200);assert.ok(audit.body.summary.modified);assert.ok(audit.body.summary.approved);
 assert.equal((await finance.get('/api/audit-history?area=retirement')).status,403);
 assert.deepEqual((await q('SELECT id,status FROM employees ORDER BY id')).rows,before);
});
test('stale proposals cannot overwrite a newer retirement setting',async()=>{
 const pending=await hr.put('/api/retirement/settings').send({retirementAge:63,version:3});assert.equal(pending.status,202);
 assert.equal((await admin.put('/api/retirement/settings').send({retirementAge:65,version:3})).status,200);
 assert.equal((await admin.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status,409);
 assert.equal((await admin.get('/api/retirement')).body.settings.retirementAge,65);
 const audit=await admin.get('/api/audit-history?area=retirement');assert.equal(audit.body.summary.modified.actor,audit.body.summary.approved.actor);
});
