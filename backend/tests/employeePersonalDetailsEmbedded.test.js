// Serial embedded PostgreSQL integration: migration, validation, approvals and self-profile privacy.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/personal_details';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');
const q=(sql,args)=>db.query(sql,args);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{signIn}=await import('./hrClient.js'),{hashPassword}=await import('../src/services/password.js');
let admin,hr,finance,root,shift,legacyId,n=0;
const password='password-123';
const body=extra=>({username:`person${++n}`,employeeCode:`P-${n}`,fullName:`Person ${n}`,startDate:'2020-01-01',password,shiftId:Number(shift),...extra});
const create=async extra=>{const r=await admin.post('/api/employees').send(body(extra));assert.equal(r.status,201,JSON.stringify(r.body));return r.body;};
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url),files=(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>!f.startsWith('017_')))await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 shift=(await q("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','08:00','17:00') RETURNING id")).rows[0].id;
 const user=(await q("INSERT INTO users(username,full_name,password_hash,role) VALUES('legacy','Legacy employee',$1,'employee') RETURNING id",[await hashPassword(password)])).rows[0].id;
 legacyId=(await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id) VALUES('LEGACY',$1,'2020-01-01',$2) RETURNING id",[user,shift])).rows[0].id;
 await db.exec(await fs.readFile(new URL('017_employee_personal_details.sql',dir),'utf8'));
 root=(await seedAdmin({username:'root',password})).id;admin=await signIn(app,{username:'root',password});
 for(const role of ['hr','finance']){const e=await create({username:`${role}.details`});await q('UPDATE users SET must_change_password=false WHERE id=$1',[e.userId]);await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[e.userId,role,root]);const client=await signIn(app,{username:`${role}.details`,password});if(role==='hr')hr=client;else finance=client;}
});
after(()=>db.close());
test('migration preserves old employees without inventing personal facts',async()=>{
 const r=await admin.get(`/api/employees/${legacyId}`);assert.equal(r.status,200);for(const key of ['gender','dateOfBirth','fieldOfStudy'])assert.equal(r.body[key],null);
});
test('create, list, edit and clear personal fields; self-profile remains HR managed',async()=>{
 const e=await create({gender:'female',dateOfBirth:'2000-02-29',fieldOfStudy:' Economics '});
 assert.equal(e.gender,'female');assert.equal(e.dateOfBirth,'2000-02-29');assert.equal(e.fieldOfStudy,'Economics');
 const rows=await admin.get('/api/employees?search='+e.username);assert.equal(rows.body.items[0].dateOfBirth,'2000-02-29');
 await q('UPDATE users SET must_change_password=false WHERE id=$1',[e.userId]);const employee=await signIn(app,{username:e.username,password});
 const profile=await employee.get('/api/profile');assert.equal(profile.body.gender,'female');assert.equal(profile.body.fieldOfStudy,'Economics');assert.equal(profile.body.dateOfBirth,'2000-02-29');
 assert.equal((await employee.patch(`/api/employees/${e.id}`).send({gender:'male'})).status,403);
 const self=await employee.put('/api/profile/experience').send({experienceSummary:'My experience',gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Forged'});assert.equal(self.status,200);
 assert.equal((await employee.get('/api/profile')).body.gender,'female');
 const changed=await admin.patch(`/api/employees/${e.id}`).send({gender:'male',fieldOfStudy:'Accounting'});assert.equal(changed.status,200);assert.equal(changed.body.gender,'male');
 const logs=(await q("SELECT details FROM audit_logs WHERE entity_type='employee' AND entity_id=$1 AND action='employee.update' ORDER BY id DESC LIMIT 1",[String(e.id)])).rows;
 assert.deepEqual(logs[0].details.changes.gender,{from:'female',to:'male'});
 const cleared=await admin.patch(`/api/employees/${e.id}`).send({gender:null,dateOfBirth:null,fieldOfStudy:null});assert.equal(cleared.status,200);for(const key of ['gender','dateOfBirth','fieldOfStudy'])assert.equal(cleared.body[key],null);
});
test('invalid gender, calendar dates, future dates and oversized study text are rejected before creating a login',async()=>{
 const before=Number((await q('SELECT count(*) n FROM users')).rows[0].n);
 for(const extra of [{gender:'other'},{gender:'Male'},{dateOfBirth:'2001-02-29'},{dateOfBirth:'2999-01-01'},{dateOfBirth:'0000-01-01'},{fieldOfStudy:'x'.repeat(151)}]){const r=await admin.post('/api/employees').send(body(extra));assert.ok([400,422].includes(r.status),JSON.stringify(r.body));}
 assert.equal(Number((await q('SELECT count(*) n FROM users')).rows[0].n),before);
 await assert.rejects(q("UPDATE employees SET gender='other' WHERE id=$1",[legacyId]),/check constraint/);
});
test('HR personal-detail edits wait for independent approval; Finance cannot modify them',async()=>{
 const e=await create({});
 const p=await hr.patch(`/api/employees/${e.id}`).send({gender:'female',dateOfBirth:'1995-01-15',fieldOfStudy:'Development economics'});assert.equal(p.status,202,JSON.stringify(p.body));
 assert.equal((await admin.get(`/api/employees/${e.id}`)).body.gender,null);
 assert.equal((await hr.post(`/api/change-requests/${p.body.requestId}/approve`).send({})).status,403);
 assert.equal((await finance.patch(`/api/employees/${e.id}`).send({gender:'male'})).status,403);
 const approved=await admin.post(`/api/change-requests/${p.body.requestId}/approve`).send({});assert.equal(approved.status,200,JSON.stringify(approved.body));
 const saved=(await admin.get(`/api/employees/${e.id}`)).body;assert.equal(saved.dateOfBirth,'1995-01-15');assert.equal(saved.fieldOfStudy,'Development economics');
});
