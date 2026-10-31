import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/shared_read_access_test';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');
const q=(s,p)=>db.query(s,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{signIn}=await import('./hrClient.js');
let admin,hr,finance,plain,root,shift,department,employee,period;
const password='password-123';
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 root=(await seedAdmin({username:'root',password})).id;admin=await signIn(app,{username:'root',password});
 shift=(await admin.post('/api/shifts').send({name:'Day',startTime:'09:00',endTime:'17:00',workDays:[1,2,3,4,5],graceMinutes:0})).body.id;
 department=(await admin.post('/api/departments').send({name:'Shared view'})).body.id;
 for(const role of ['hr','finance','plain']){
  const r=await admin.post('/api/employees').send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',username:role+'.user',employeeCode:role,fullName:role,password,startDate:'2026-01-01',employmentType:'full_time',shiftId:shift,departmentId:department});assert.equal(r.status,201,JSON.stringify(r.body));
  await q('UPDATE users SET must_change_password=false WHERE id=$1',[r.body.userId]);
  if(role!=='plain')await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[r.body.userId,role,root]);else employee=r.body;
 }
 hr=await signIn(app,{username:'hr.user',password});finance=await signIn(app,{username:'finance.user',password});plain=await signIn(app,{username:'plain.user',password});
 await q('INSERT INTO salary_profiles(employee_id,basic_minor,allowance_minor) SELECT id,200000,10000 FROM employees');
 await q('INSERT INTO income_tax_brackets(from_minor,rate,fixed_deduction_minor) VALUES(0,10,0)');
 let r=await admin.post('/api/payroll/periods').send({month:'2026-06'});assert.equal(r.status,201,JSON.stringify(r.body));period=r.body.id;
 assert.equal((await admin.post(`/api/payroll/periods/${period}/approve`).send({})).status,200);
 assert.equal((await admin.post(`/api/payroll/periods/${period}/pay`).send({paidOn:'2026-06-30'})).status,200);
 await admin.post('/api/announcements').send({title:'Draft notice',body:'Draft visible to administrative readers',status:'draft',expiresOn:null});
});
after(async()=>db.close());
test('both HR and Finance can read all administrative sidebar data and detail endpoints',async()=>{
 const paths=['/api/dashboard','/api/employees',`/api/employees/${employee.id}`,'/api/departments',`/api/departments/${department}`,`/api/departments/${department}/positions`,'/api/shifts','/api/settings/holidays','/api/attendance-records','/api/leave-admin/requests',`/api/leave-admin/balances?employeeId=${employee.id}`,'/api/payroll-settings/calculation',`/api/salary-profiles/${employee.id}`,'/api/payroll-costs','/api/settlements',`/api/settlements/${period}`,`/api/settlements/${period}/payments?kind=income_tax`,'/api/access-management/employees',`/api/access-management/employees/${employee.id}/history`,'/api/change-requests','/api/qr/status'];
 for(const client of [hr,finance])for(const path of paths){const r=await client.get(path);assert.equal(r.status,200,path+': '+JSON.stringify(r.body));}
 assert.ok((await finance.get('/api/announcements?status=draft')).body.items.some(x=>x.title==='Draft notice'));
 assert.equal((await plain.get('/api/announcements?status=draft')).body.total,0);
 for(const path of ['/api/dashboard','/api/departments','/api/settlements','/api/access-management/employees','/api/qr/status'])assert.equal((await plain.get(path)).status,403,path);
});
test('view permissions cannot mutate another department or issue/revoke access',async()=>{
 for(const [client,method,path,body]of [
  [finance,'post','/api/employees',{}],[finance,'patch',`/api/employees/${employee.id}`,{phone:'0911111111'}],
  [finance,'post','/api/departments',{}],[finance,'patch',`/api/departments/${department}`,{name:'Denied'}],
  [finance,'post',`/api/departments/${department}/positions`,{}],[finance,'post','/api/shifts',{}],
  [finance,'post','/api/settings/holidays',{}],[finance,'patch','/api/attendance-records/1',{}],
  [finance,'post','/api/leave-admin/requests/1/approve',{}],[finance,'post','/api/announcements',{}],
  [finance,'put',`/api/salary-profiles/${employee.id}`,{}],[finance,'post','/api/qr/tokens',{}],[finance,'post','/api/qr/lock',{}],
  [hr,'patch','/api/payroll-settings/calculation',{companyPensionRate:20}],[hr,'post','/api/deductions',{}],
  [hr,'post',`/api/payroll/periods/${period}/approve`,{}],[hr,'post',`/api/payroll/periods/${period}/pay`,{}],
  [hr,'post',`/api/settlements/${period}/payments`,{}],
  [hr,'post',`/api/access-management/employees/${employee.id}/grants`,{role:'hr'}],
  [finance,'post',`/api/access-management/employees/${employee.id}/grants`,{role:'finance'}],
  [hr,'post',`/api/access-management/employees/${employee.id}/grants/1/revoke`,{reason:'Not allowed'}]
 ]){const r=await client[method](path).send(body);assert.equal(r.status,403,method+' '+path+': '+JSON.stringify(r.body));}
});
test('cross-department proposals are visible but cannot be approved by the unrelated role',async()=>{
 const submitted=await hr.patch(`/api/departments/${department}`).send({name:'Pending HR change'});assert.equal(submitted.status,202);const id=submitted.body.requestId;
 const detail=await finance.get(`/api/change-requests/${id}`);assert.equal(detail.status,200);assert.equal(detail.body.canReview,false);
 const list=await finance.get('/api/change-requests');assert.ok(list.body.items.some(x=>x.id===id&&!x.canReview));
 assert.equal((await finance.post(`/api/change-requests/${id}/approve`).send({})).status,403);
 assert.equal((await finance.post(`/api/change-requests/${id}/reject`).send({reason:'Unrelated role'})).status,403);
 assert.equal((await finance.post(`/api/change-requests/${id}/cancel`).send({})).status,403);
 assert.equal((await admin.post(`/api/change-requests/${id}/approve`).send({})).status,200);
 const created=await hr.post('/api/employees').send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',username:'queued.user',employeeCode:'queued',fullName:'Queued user',password,startDate:'2026-01-01',shiftId:shift});assert.equal(created.status,202);
 const preview=await finance.get(`/api/change-requests/${created.body.requestId}`);assert.equal(preview.status,200);assert.equal(preview.body.payload_preview.password,'[protected]');assert.ok(!JSON.stringify(preview.body).includes(password));assert.equal('payload_cipher' in preview.body,false);
});
test('QR status reveals metadata without granting generation or exposing bearer tokens',async()=>{
 const issued=await admin.post('/api/qr/tokens').send({});assert.equal(issued.status,201);
 const status=await finance.get('/api/qr/status');assert.equal(status.status,200);assert.equal(status.body.active,true);assert.ok(status.body.expiresAt);
 assert.ok(!JSON.stringify(status.body).includes(issued.body.token));assert.equal('token_hash' in status.body,false);
 assert.equal((await finance.post('/api/qr/tokens').send({})).status,403);
});
