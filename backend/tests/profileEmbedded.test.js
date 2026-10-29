import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test'; process.env.DATABASE_URL='postgres://unused/profile_test';
const db=new PGlite({ extensions: { btree_gist } });
const { pool }=await import('../src/db/pool.js');
const q=(sql,params)=>db.query(sql,params);
pool.query=q; pool.connect=async()=>({query:q,release(){}});
const { app }=await import('../src/server.js');
const { signIn }=await import('./hrClient.js');
const { hashPassword }=await import('../src/services/password.js');
const request=(await import('supertest')).default;
let employee, other, hr, employeeId, position;
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 const files=(await fs.readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
 for(const name of files.filter(n=>!n.startsWith('006_'))) await db.exec(await fs.readFile(new URL(name,dir),'utf8'));
 const shift=(await q("INSERT INTO shifts(name,start_time,end_time,work_days) VALUES('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id")).rows[0].id;
 const department=(await q("INSERT INTO departments(name) VALUES('Technology') RETURNING id")).rows[0].id;
 position=(await q("INSERT INTO positions(department_id,name) VALUES($1,'Developer') RETURNING id",[department])).rows[0].id;
 for(const [email,role,code] of [['employee@profile.test','employee','E-1'],['other@profile.test','employee','E-2'],['hr@profile.test','hr',null]]) {
  const u=(await q('INSERT INTO users(email,full_name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[email,email,await hashPassword('password-123'),role])).rows[0].id;
  if(code){const r=await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id,department_id,position_id,phone) VALUES($1,$2,'2025-01-01',$3,$4,$5,'0911111111') RETURNING id",[code,u,shift,department,position]); if(code==='E-1')employeeId=r.rows[0].id;}
 }
 await db.exec(await fs.readFile(new URL('006_employee_profile.sql',dir),'utf8'));
 employee=await signIn(app,{email:'employee@profile.test',password:'password-123'});
 other=await signIn(app,{email:'other@profile.test',password:'password-123'});
 hr=await signIn(app,{email:'hr@profile.test',password:'password-123'});
});
after(async()=>db.close());
test('profile requires an employee session and exposes only own employment facts',async()=>{
 assert.equal((await request(app).get('/api/profile')).status,401);
 assert.equal((await hr.get('/api/profile')).status,403);
 const r=await employee.get('/api/profile?employeeId=2');
 assert.equal(r.status,200);assert.equal(r.body.employeeCode,'E-1');assert.equal(r.body.department,'Technology');assert.equal(r.body.position,'Developer');assert.equal(r.body.phone,'0911111111');
 assert.equal(r.body.password_hash,undefined);assert.equal(r.body.basicMinor,undefined);
});
test('experience is validated, audited and isolated to the signed-in employee',async()=>{
 assert.equal((await employee.put('/api/profile/experience').send({experienceSummary:'Worked as an analyst',employeeId:2})).status,200);
 assert.equal((await employee.get('/api/profile')).body.experienceSummary,'Worked as an analyst');
 assert.equal((await other.get('/api/profile')).body.experienceSummary,'');
 assert.equal((await employee.put('/api/profile/experience').send({experienceSummary:'x'.repeat(5001)})).status,400);
 assert.equal((await employee.put('/api/profile/experience').send({})).status,400);
 assert.equal((await employee.put('/api/profile/experience').send({experienceSummary:null})).status,200);
 assert.equal((await employee.get('/api/profile')).body.experienceSummary,'');
 const count=await q("SELECT count(*)::int AS n FROM audit_logs WHERE action='employee.experience.update'");assert.equal(count.rows[0].n,2);
});
test('migration seeds a labelled baseline; assignments append snapshots and paginate without leaking history',async()=>{
 let r=await employee.get('/api/profile/positions');assert.equal(r.status,200);assert.equal(r.body.total,1);assert.equal(r.body.items[0].baseline,true);
 await q("UPDATE positions SET name='Senior Developer' WHERE id=$1",[position]);
 // Employee job title follows the HR position route; the saved snapshot retains the old name.
 await q("UPDATE employees SET job_title='Senior Developer' WHERE id=$1",[employeeId]);
 r=await employee.get('/api/profile/positions?pageSize=1&page=1');assert.equal(r.body.total,2);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].position,'Senior Developer');assert.equal(r.body.items[0].baseline,false);
 r=await employee.get('/api/profile/positions?pageSize=1&page=2');assert.equal(r.body.items[0].position,'Developer');
 assert.equal((await other.get('/api/profile/positions')).body.total,1);
 assert.equal((await employee.get('/api/profile/positions?pageSize=1000')).status,400);
 await q('UPDATE employees SET phone=$2 WHERE id=$1',[employeeId,'0922222222']);
 assert.equal((await employee.get('/api/profile/positions')).body.total,2);
});
