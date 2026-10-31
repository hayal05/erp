import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/password_change_test';
const db=new PGlite({extensions:{btree_gist}});
const {pool}=await import('../src/db/pool.js');
const q=(sql,params)=>db.query(sql,params);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js');
const {hashPassword,verifyPassword}=await import('../src/services/password.js');
const {passwordChangeLimit}=await import('../src/routes/changePassword.js');
const request=(await import('supertest')).default;
const oldPassword='temporary-123',newPassword='my-private-password-456';
let hr,employee,other,shift,userId;
async function login(email,password){const agent=request.agent(app);const r=await agent.post('/api/auth/login').send({email,password});assert.equal(r.status,200,JSON.stringify(r.body));return {agent,csrf:r.body.csrfToken,user:r.body.user};}
const change=(client,body)=>client.agent.post('/api/auth/password').set('X-CSRF-Token',client.csrf).send(body);
const body=(overrides={})=>({currentPassword:oldPassword,newPassword,confirmPassword:newPassword,...overrides});
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 const files=(await fs.readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
 for(const name of files.filter(n=>!n.startsWith('008_')))await db.exec(await fs.readFile(new URL(name,dir),'utf8'));
 shift=(await q("INSERT INTO shifts(name,start_time,end_time,work_days) VALUES('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id")).rows[0].id;
 for(const role of ['hr','employee']){
  const u=(await q('INSERT INTO users(email,full_name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[`${role}@pw.test`,role,await hashPassword(oldPassword),role])).rows[0].id;
  if(role==='hr')await q("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[u]);
  if(role==='employee'){userId=u;await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id) VALUES('E-1',$1,'2026-01-01',$2)",[u,shift]);}
 }
 await db.exec(await fs.readFile(new URL('008_employee_password_change.sql',dir),'utf8'));
 hr=await login('hr@pw.test',oldPassword);employee=await login('employee@pw.test',oldPassword);other=await login('employee@pw.test',oldPassword);
});
after(async()=>db.close());
test('migration marks existing employees and new HR-created accounts use temporary passwords',async()=>{
 assert.equal(employee.user.mustChangePassword,true);assert.equal(hr.user.mustChangePassword,false);
 const r=await hr.agent.post('/api/employees').set('X-CSRF-Token',hr.csrf).send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',employeeCode:'E-2',fullName:'New Person',username: 'new@pw.test', email:'new@pw.test',password:oldPassword,startDate:'2026-10-01',employmentType:'full_time',shiftId:Number(shift)});
 assert.equal(r.status,201,JSON.stringify(r.body));assert.equal((await login('new@pw.test',oldPassword)).user.mustChangePassword,true);
});
test('temporary sessions can only access password, session and logout endpoints',async()=>{
 assert.equal((await employee.agent.get('/api/auth/me')).body.user.mustChangePassword,true);
 for(const path of ['/api/profile','/api/attendance/mine','/api/leave','/api/payslips']){
  const r=await employee.agent.get(path);assert.equal(r.status,403,path);assert.equal(r.body.error.code,'password_change_required');
 }
 assert.equal((await request(app).post('/api/auth/password').send(body())).status,401);
 assert.equal((await change(hr,body())).status,403);
 assert.equal((await employee.agent.post('/api/auth/password').send(body())).status,403);
});
test('current password, confirmation, strength, bcrypt byte limit and new-password reuse are checked',async()=>{
 assert.equal((await change(employee,body({currentPassword:'wrong-password'}))).body.error.code,'invalid_password');
 assert.equal((await change(employee,body({confirmPassword:'different'}))).status,400);
 assert.equal((await change(employee,body({newPassword:'short',confirmPassword:'short'}))).status,400);
 assert.equal((await change(employee,body({newPassword:'é'.repeat(40),confirmPassword:'é'.repeat(40)}))).status,400);
 assert.equal((await change(employee,body({newPassword:oldPassword,confirmPassword:oldPassword}))).status,400);
 assert.equal((await employee.agent.get('/api/auth/me')).body.user.mustChangePassword,true);
});
test('successful change clears requirement, revokes other sessions, rotates CSRF and never logs passwords',async()=>{
 const r=await change(employee,body());assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.user.mustChangePassword,false);assert.notEqual(r.body.csrfToken,employee.csrf);
 assert.equal((await employee.agent.get('/api/profile')).status,200);
 assert.equal((await other.agent.get('/api/auth/me')).status,401);
 assert.equal((await employee.agent.post('/api/auth/logout').set('X-CSRF-Token',employee.csrf).send({})).status,403);
 const stored=(await q('SELECT password_hash,must_change_password FROM users WHERE id=$1',[userId])).rows[0];
 assert.equal(stored.must_change_password,false);assert.ok(await verifyPassword(newPassword,stored.password_hash));assert.equal(await verifyPassword(oldPassword,stored.password_hash),false);
 const audit=(await q("SELECT details FROM audit_logs WHERE action='auth.password.change'")).rows;assert.equal(audit.length,1);assert.ok(!JSON.stringify(audit).includes(newPassword));assert.ok(!JSON.stringify(audit).includes(oldPassword));
 assert.equal((await request(app).post('/api/auth/login').send({email:'employee@pw.test',password:oldPassword})).status,401);
 employee=await login('employee@pw.test',newPassword);assert.equal(employee.user.mustChangePassword,false);
});
test('employees can change their password again and failed current-password guesses are throttled',async()=>{
 const updated='another-private-password-789';
 const r=await change(employee,{currentPassword:newPassword,newPassword:updated,confirmPassword:updated});assert.equal(r.status,200);employee.csrf=r.body.csrfToken;
 passwordChangeLimit.clear();
 for(let i=0;i<5;i++)assert.equal((await change(employee,body({currentPassword:'wrong-password'}))).status,400);
 assert.equal((await change(employee,body({currentPassword:'wrong-password'}))).status,429);
});
