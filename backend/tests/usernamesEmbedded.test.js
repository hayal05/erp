import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/usernames_test';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');
const q=(s,p)=>db.query(s,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{hashPassword}=await import('../src/services/password.js'),{seedAdmin}=await import('../src/db/seed.js'),{loginLimits}=await import('../src/routes/auth.js'),{signIn}=await import('./hrClient.js');
const request=(await import('supertest')).default;
let admin,hr,hr2,root,shift,person,privileged;
const password='password-123';
const body=(username,email)=>({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',username,employeeCode:username.replaceAll('.','-'),fullName:username,password,startDate:'2026-01-01',employmentType:'full_time',shiftId:shift,...(email?{email}:{})});
const login=(username,pw=password)=>request(app).post('/api/auth/login').send({username,password:pw});
const approve=async(reviewer,id)=>reviewer.post(`/api/change-requests/${id}/approve`).send({});
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url),files=(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>f<'013_'))await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 root=(await q("INSERT INTO users(email,full_name,password_hash,role) VALUES('legacy@username.test','Legacy Admin',$1,'hr') RETURNING id",[await hashPassword(password)])).rows[0].id;
 await q("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[root]);
 await db.exec(await fs.readFile(new URL('013_usernames.sql',dir),'utf8'));
 for(const f of files.filter(f=>f>'013_usernames.sql'))await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 admin=await signIn(app,{username:'legacy@username.test',password});
 shift=(await admin.post('/api/shifts').send({name:'Day',startTime:'09:00',endTime:'17:00',workDays:[1,2,3,4,5],graceMinutes:0})).body.id;
 for(const name of ['hr.one','hr.two']){
  const r=await admin.post('/api/employees').send(body(name));assert.equal(r.status,201,JSON.stringify(r.body));
  await q('UPDATE users SET must_change_password=false WHERE id=$1',[r.body.userId]);
  await q("INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,'hr',$2)",[r.body.userId,root]);
  if(name==='hr.one')privileged=r.body;
 }
 hr=await signIn(app,{username:'hr.one',password});hr2=await signIn(app,{username:'hr.two',password});
});
beforeEach(()=>{loginLimits.ip.clear();loginLimits.pair.clear();});
after(async()=>db.close());
test('migration keeps existing credentials, Admin grants and username-based seed recovery',async()=>{
 const r=await login(' LEGACY@USERNAME.TEST ');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.user.username,'legacy@username.test');assert.ok(r.body.user.accessRoles.includes('admin'));
 assert.equal((await seedAdmin({email:'legacy@username.test',password})).created,false);
 const seeded=await seedAdmin({username:'new.admin',password,name:'New Admin'});assert.equal(seeded.created,true);
 assert.equal((await login('new.admin')).status,200);
 await q("UPDATE users SET email='contact.changed@test.co' WHERE id=$1",[root]);
 assert.equal((await seedAdmin({username:'legacy@username.test',password,resetPassword:true})).passwordReset,true);
 // Reset revokes the old Admin session; sign in again for later tests.
 admin=await signIn(app,{username:'legacy@username.test',password});
});
test('registration requires a unique username but no email; password setup and sessions expose it',async()=>{
 let r=await admin.post('/api/employees').send(body('Hana.Login'));assert.equal(r.status,201,JSON.stringify(r.body));person=r.body;
 assert.equal(person.username,'hana.login');assert.equal(person.email,null);
 r=await login('HANA.LOGIN');assert.equal(r.status,200);assert.equal(r.body.user.mustChangePassword,true);
 const agent=request.agent(app);r=await agent.post('/api/auth/login').send({username:'hana.login',password});
 r=await agent.post('/api/auth/password').set('X-CSRF-Token',r.body.csrfToken).send({currentPassword:password,newPassword:'new-password-123',confirmPassword:'new-password-123'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.user.username,'hana.login');
 assert.equal((await agent.get('/api/auth/me')).body.user.username,'hana.login');
 assert.equal((await agent.get('/api/profile')).body.username,'hana.login');
 assert.ok((await admin.get('/api/employees?search=hana.login')).body.items.some(e=>e.id===person.id));
 r=await admin.post('/api/employees').send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',...body('HANA.LOGIN'),employeeCode:'duplicate'});assert.equal(r.status,409);assert.ok(r.body.error.details.fields.username);
 const missing=body('missing');delete missing.username;missing.email='contact@optional.test';
 r=await admin.post('/api/employees').send(missing);assert.equal(r.status,400);assert.ok(r.body.error.details.fields.username);
 assert.equal((await admin.post('/api/employees').send(body('bad name'))).status,400);
});
test('contact emails can be shared, changed or removed and never become login aliases',async()=>{
 const email='shared@optional.test';
 for(const username of ['contact.one','contact.two'])assert.equal((await admin.post('/api/employees').send(body(username,email))).status,201);
 assert.equal((await login(email)).status,401);
 assert.equal((await request(app).post('/api/auth/login').send({email,password})).status,401);
 let r=await admin.patch(`/api/employees/${person.id}`).send({email});assert.equal(r.status,200);assert.equal(r.body.username,'hana.login');
 assert.equal((await login('hana.login','new-password-123')).status,200);
 r=await admin.patch(`/api/employees/${person.id}`).send({email:null});assert.equal(r.status,200);assert.equal(r.body.email,null);
 assert.equal((await login('hana.login','new-password-123')).status,200);
});
test('HR-assigned usernames follow approval, and privileged username edits remain Admin-only',async()=>{
 let r=await hr.post('/api/employees').send(body('queued.login'));assert.equal(r.status,202,JSON.stringify(r.body));const pending=r.body.requestId;
 assert.equal((await login('queued.login')).status,401);
 r=await approve(hr2,pending);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal((await login('queued.login')).status,200);
 r=await hr.patch(`/api/employees/${person.id}`).send({username:'hana.renamed'});assert.equal(r.status,202);assert.equal((await approve(hr2,r.body.requestId)).status,200);
 assert.equal((await login('hana.login','new-password-123')).status,401);assert.equal((await login('hana.renamed','new-password-123')).status,200);
 r=await hr.patch(`/api/employees/${privileged.id}`).send({username:'privileged.rename'});assert.equal(r.status,202);assert.equal((await approve(hr2,r.body.requestId)).status,403);
 r=await hr.patch(`/api/employees/${privileged.id}`).send({email:'optional.contact@test.co'});assert.equal(r.status,202);assert.equal((await approve(hr2,r.body.requestId)).status,200);
 const history=await admin.get(`/api/audit-history/employee/${person.id}`);assert.ok(history.body.items.some(i=>i.changes.some(c=>c.field==='username')));
});
