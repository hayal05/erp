import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/custom_access';
const db=new PGlite({extensions:{btree_gist}}),q=(sql,args)=>db.query(sql,args);
const {pool}=await import('../src/db/pool.js');pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{hashPassword}=await import('../src/services/password.js'),{signIn}=await import('./hrClient.js');
const {companyDate}=await import('../src/services/attendance.js'),{checkQrToken}=await import('../src/services/qrToken.js');
let admin,root,leader,reviewer,outsider,plain,depA,depB,inside,outside,recordA,recordB,role,leaderId,reviewerId,outsideManagerId,outsiderGrant;
const password='password-123';let shift,hash;
async function person(name,dep){
 const u=(await q("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$1,$2,'employee') RETURNING id",[name,hash])).rows[0].id;
 const e=(await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id,department_id,gender,date_of_birth,field_of_study) VALUES($1,$2,'2020-01-01',$3,$4,'male','1990-01-01','Test study') RETURNING id",[name,u,shift,dep])).rows[0].id;
 return {id:Number(e),userId:Number(u),client:await signIn(app,{username:name,password})};
}
async function newRole(name,activities){const r=await admin.post('/api/custom-access/roles').send({name,activities});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function assign(employeeId,roleId,scopeType,ids=[]){const r=await admin.post(`/api/custom-access/employees/${employeeId}/custom-grants`).send({roleId,scopeType,departmentIds:scopeType==='departments'?ids:[],employeeIds:scopeType==='employees'?ids:[]});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 root=(await seedAdmin({username:'root',password})).id;admin=await signIn(app,{username:'root',password});hash=await hashPassword(password);
 shift=(await q("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','08:00','17:00') RETURNING id")).rows[0].id;
 depA=Number((await q("INSERT INTO departments(name) VALUES('A') RETURNING id")).rows[0].id);depB=Number((await q("INSERT INTO departments(name) VALUES('B') RETURNING id")).rows[0].id);
 const l=await person('team.leader',depA);leader=l.client;leaderId=l.id;
 const r=await person('department.manager',depA);reviewer=r.client;reviewerId=r.id;
 const o=await person('other.manager',depB);outsider=o.client;outsideManagerId=o.id;
 inside=await person('inside.employee',depA);outside=await person('outside.employee',depB);plain=inside.client;
 for(const [e,name] of [[inside,'A'],[outside,'B']]){const id=(await q("INSERT INTO attendance_records(employee_id,work_date,status) VALUES($1,$2,'absent') RETURNING id",[e.id,companyDate()])).rows[0].id;if(name==='A')recordA=Number(id);else recordB=Number(id);}
});
after(()=>db.close());
test('only General Admin creates roles; protected/unknown permissions and duplicate names are refused',async()=>{
 assert.equal((await leader.post('/api/custom-access/roles').send({name:'Escalate',activities:['attendance.read']})).status,403);
 for(const activities of [['access.manage'],['self.profile'],['*'],[]])assert.equal((await admin.post('/api/custom-access/roles').send({name:'Invalid',activities})).status,400);
 role=await newRole('Team Leader',['employees.read','attendance.read','attendance.qr','attendance.qr.lock']);
 assert.ok(role.permissions.includes('attendance.qr.read'));
 assert.equal((await admin.post('/api/custom-access/roles').send({name:'team leader',activities:['attendance.read']})).status,400);
 assert.equal((await plain.get('/api/custom-access/roles')).status,403);
});
test('department grants are effective in existing sessions and scope lists, counts, lookups, profiles and retirement',async()=>{
 await assign(leaderId,role.id,'departments',[depA]);
 const me=await leader.get('/api/auth/me');assert.equal(me.body.user.customGrants[0].name,'Team Leader');assert.ok(me.body.user.permissions.includes('attendance.read'));assert.ok(!me.body.user.permissions.includes('payroll.read'));
 const e=await leader.get('/api/employees');assert.equal(e.status,200,JSON.stringify(e.body));assert.ok(e.body.items.some(x=>x.id===inside.id));assert.ok(e.body.items.every(x=>x.departmentId===depA));assert.equal(e.body.total,3);
 await q('UPDATE employees SET department_id=$1 WHERE id=$2',[depA,outside.id]);assert.equal((await leader.get('/api/employees')).body.total,4);await q('UPDATE employees SET department_id=$1 WHERE id=$2',[depB,outside.id]);
 assert.equal((await leader.get(`/api/employees/${inside.id}/profile`)).status,200);assert.equal((await leader.get(`/api/employees/${outside.id}/profile`)).status,404);
 const a=await leader.get('/api/attendance-records?view=today');assert.equal(a.status,200,JSON.stringify(a.body));assert.ok(a.body.items.every(x=>x.departmentId===depA));assert.ok(a.body.items.every(x=>x.canCorrect===false));
 const lookup=await leader.get('/api/attendance-records/lookups');assert.equal(lookup.status,200);assert.ok(lookup.body.employees.every(e=>Number(e.departmentId)===depA));
 assert.equal((await leader.get('/api/retirement')).body.total,3);
 assert.equal((await leader.get(`/api/employees/${outside.id}/attachments?direction=incoming`)).status,404);
 assert.equal((await leader.get(`/api/attendance-records/${recordB}/photos/check_in`)).status,404);
 assert.equal((await q('SELECT count(*)::int AS n FROM attendance_records WHERE employee_id=$1',[outsideManagerId])).rows[0].n,0);
 assert.equal((await leader.get('/api/dashboard')).status,403);assert.equal((await leader.get('/api/payroll/periods')).status,403);
 assert.equal((await leader.patch(`/api/attendance-records/${recordA}`).send({status:'absent',reason:'Follow up'})).status,403);
});
test('scoped activities reject company-wide additions and missing selections; definitions use optimistic versions',async()=>{
 assert.equal((await admin.put(`/api/custom-access/roles/${role.id}`).send({name:role.name,version:role.version,activities:['payroll.read']})).status,400);
 const payroll=await newRole('Payroll Viewer',['payroll.read']);
 assert.equal((await admin.post(`/api/custom-access/employees/${reviewerId}/custom-grants`).send({roleId:payroll.id,scopeType:'departments',departmentIds:[depA]})).status,400);
 assert.equal((await admin.post(`/api/custom-access/employees/${reviewerId}/custom-grants`).send({roleId:role.id,scopeType:'employees',employeeIds:[]})).status,400);
 const r=await admin.put(`/api/custom-access/roles/${role.id}`).send({name:role.name,version:role.version,activities:[...role.activities,'attendance.manage','changes.hr.approve']});assert.equal(r.status,200,JSON.stringify(r.body));role=r.body;
 assert.equal((await admin.put(`/api/custom-access/roles/${role.id}`).send({name:role.name,version:1,activities:role.activities})).status,409);
 await assign(reviewerId,role.id,'departments',[depA]);outsiderGrant=await assign(outsideManagerId,role.id,'employees',[outside.id]);
});
test('corrections and approval queues enforce record scope, independent reviewers and replay-time authorization',async()=>{
 assert.equal((await leader.patch(`/api/attendance-records/${recordB}`).send({status:'absent',reason:'Not my team'})).status,404);
 const pending=await leader.patch(`/api/attendance-records/${recordA}`).send({status:'incomplete',reason:'Team follow-up'});assert.equal(pending.status,202,JSON.stringify(pending.body));
 assert.equal((await leader.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status,403);
 const other=await outsider.get('/api/change-requests');assert.equal(other.status,200,JSON.stringify(other.body));assert.ok(!other.body.items.some(r=>r.id===pending.body.requestId));
 assert.equal((await outsider.get(`/api/change-requests/${pending.body.requestId}`)).status,404);
 assert.ok([403,404].includes((await outsider.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status));
 const assignments=await admin.get(`/api/custom-access/employees/${reviewerId}/custom-grants?pageSize=1`);assert.equal(assignments.body.total,1);assert.deepEqual(assignments.body.items[0].departmentNames,['A']);
 const approved=await reviewer.post(`/api/change-requests/${pending.body.requestId}/approve`).send({});assert.equal(approved.status,200,JSON.stringify(approved.body));
 const audit=await reviewer.get('/api/audit-history?area=attendance');assert.equal(audit.status,200,JSON.stringify(audit.body));assert.ok(audit.body.items.every(e=>e.recordId===String(recordA)));assert.ok(audit.body.summary.approved);
 assert.equal((await reviewer.get(`/api/audit-history/attendance_record/${recordB}`)).status,404);
});
test('custom QR issuers are authorized live, scope scans, and can lock/unlock only their own screen',async()=>{
 const token=await leader.post('/api/qr/tokens').send({});assert.equal(token.status,201,JSON.stringify(token.body));
 assert.ok(await checkQrToken({query:q},token.body.token,{employeeId:inside.id}));
 await assert.rejects(checkQrToken({query:q},token.body.token,{employeeId:outside.id}),e=>e.status===403);
 assert.equal((await leader.post('/api/qr/lock').send({})).status,200);assert.equal((await leader.get('/api/employees')).status,423);
 assert.equal((await leader.post('/api/qr/unlock').send({password})).status,200);
 const pending=await leader.patch(`/api/attendance-records/${recordA}`).send({status:'absent',reason:'Pending before revocation'});assert.equal(pending.status,202);
 const grants=await admin.get(`/api/custom-access/employees/${leaderId}/custom-grants`);const grant=grants.body.items.find(g=>!g.revokedAt);
 assert.equal((await admin.post(`/api/custom-access/employees/${leaderId}/custom-grants/${grant.id}/revoke`).send({reason:'Scope changed'})).status,204);
 assert.equal((await leader.get('/api/attendance-records')).status,403);
 assert.equal((await admin.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status,409);
 await assert.rejects(checkQrToken({query:q},token.body.token,{employeeId:inside.id}),e=>e.code==='invalid_token');
 assert.ok(!(await leader.get('/api/auth/me')).body.user.permissions.includes('attendance.read'));
});
test('selected employee scope and role edits take effect without creating identities or granting general Admin',async()=>{
 const employees=await outsider.get('/api/employees');assert.equal(employees.body.total,1);assert.equal(employees.body.items[0].id,outside.id);
 assert.equal((await outsider.post('/api/custom-access/roles').send({name:'Imposter',activities:['access.read']})).status,403);
 const updated=await admin.put(`/api/custom-access/roles/${role.id}`).send({name:'Attendance Follow-up',version:role.version,activities:['employees.read','attendance.read']});assert.equal(updated.status,200);
 assert.equal((await outsider.patch(`/api/attendance-records/${recordB}`).send({reason:'No longer allowed',status:'absent'})).status,403);
 const logs=await admin.get('/api/audit-history?area=access');assert.equal(logs.status,200,JSON.stringify(logs.body));assert.ok(logs.body.items.some(e=>e.type==='custom_access_role'));
});

test('department employee management scopes writes, transfers, lookups, audit and independent approvals',async()=>{
 const managerRole=await newRole('People Manager',['employees.manage','changes.hr.approve']);
 await assign(leaderId,managerRole.id,'departments',[depA]);
 await assign(reviewerId,managerRole.id,'departments',[depA]);
 await assign(outsideManagerId,managerRole.id,'departments',[depB]);
 // A broad viewing grant must not broaden editing, uploads or approval rights.
 const readRole=await newRole('Directory Viewer',['employees.read']);await assign(leaderId,readRole.id,'all');
 const list=await leader.get('/api/employees');assert.equal(list.status,200);
 assert.equal(list.body.items.find(e=>e.id===inside.id).canManage,true);
 assert.equal(list.body.items.find(e=>e.id===outside.id).canManage,false);
 const lookups=await leader.get('/api/employees/lookups');assert.deepEqual(lookups.body.writeDepartments.map(d=>d.id),[depA]);assert.equal(lookups.body.canCreate,true);
 assert.equal((await leader.get(`/api/employees/positions?departmentId=${depA}`)).status,200);
 assert.equal((await leader.get(`/api/employees/positions?departmentId=${depB}`)).status,403);
 assert.equal((await leader.patch(`/api/employees/${outside.id}`).send({phone:'123'})).status,404);
 assert.equal((await leader.post(`/api/employees/${outside.id}/deactivate`).send({reason:'Outside'})).status,404);
 assert.equal((await leader.patch(`/api/employees/${inside.id}`).send({departmentId:depB})).status,403);
 assert.equal((await leader.patch(`/api/employees/${inside.id}`).send({departmentId:null})).status,403);
 assert.equal((await leader.get(`/api/employees/${outside.id}/salary-preview`)).status,404);
 const pdf=Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
 assert.equal((await leader.post(`/api/employees/${outside.id}/attachments`).send({direction:'incoming',fileName:'scope.pdf',fileBase64:pdf})).status,404);
 assert.equal((await leader.put('/api/retirement/settings').send({retirementAge:60,version:1})).status,403);
 assert.equal((await leader.get('/api/retirement')).body.canManageSettings,false);
 const pending=await leader.patch(`/api/employees/${inside.id}`).send({phone:'111222333'});assert.equal(pending.status,202,JSON.stringify(pending.body));
 assert.equal((await q('SELECT phone FROM employees WHERE id=$1',[inside.id])).rows[0].phone,null);
 assert.equal((await leader.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status,403);
 const inbox=await reviewer.get('/api/change-requests');assert.equal(inbox.status,200,JSON.stringify(inbox.body));assert.ok(inbox.body.items.some(r=>r.id===pending.body.requestId&&r.canReview));
 assert.equal((await outsider.get(`/api/change-requests/${pending.body.requestId}`)).status,404);
 assert.equal((await outsider.post(`/api/change-requests/${pending.body.requestId}/approve`).send({})).status,404);
 const approved=await reviewer.post(`/api/change-requests/${pending.body.requestId}/approve`).send({});assert.equal(approved.status,200,JSON.stringify(approved.body));
 assert.equal((await q('SELECT phone FROM employees WHERE id=$1',[inside.id])).rows[0].phone,'111222333');
 await admin.patch(`/api/employees/${outside.id}`).send({phone:'999888777'});
 const activity=await leader.get('/api/audit-history?area=employees');assert.equal(activity.status,200,JSON.stringify(activity.body));assert.ok(activity.body.items.some(e=>e.recordId===String(inside.id)));assert.ok(!activity.body.items.some(e=>e.recordId===String(outside.id)));
 assert.equal((await leader.get(`/api/audit-history/employee/${outside.id}`)).status,404);
 const newEmployee={employeeCode:'scope.new',username:'scope.new',fullName:'Scoped new employee',password,departmentId:depA,shiftId:Number(shift),startDate:'2020-01-01',employmentType:'full_time',gender:'female',dateOfBirth:'1995-01-01',fieldOfStudy:'Accounting'};
 assert.equal((await leader.post('/api/employees').send({...newEmployee,departmentId:depB})).status,403);
 const create=await leader.post('/api/employees').send(newEmployee);assert.equal(create.status,202,JSON.stringify(create.body));
 const reviewList=await reviewer.get('/api/change-requests');assert.ok(reviewList.body.items.some(r=>r.id===create.body.requestId&&r.canReview));
 assert.equal((await outsider.get(`/api/change-requests/${create.body.requestId}`)).status,404);
 const created=await reviewer.post(`/api/change-requests/${create.body.requestId}/approve`).send({});assert.equal(created.status,200,JSON.stringify(created.body));
 // Existing pending changes must also respect a later transfer outside the department.
 const stale=await leader.patch(`/api/employees/${inside.id}`).send({phone:'444555666'});assert.equal(stale.status,202);
 await q('UPDATE employees SET department_id=$1 WHERE id=$2',[depB,inside.id]);
 assert.equal((await reviewer.get(`/api/change-requests/${stale.body.requestId}`)).status,404);
 assert.ok([404,409].includes((await admin.post(`/api/change-requests/${stale.body.requestId}/approve`).send({})).status));
 await q('UPDATE employees SET department_id=$1 WHERE id=$2',[depA,inside.id]);
});

test('access scope options include every department, including empty departments beyond page one',async()=>{
 const inserted=await q("INSERT INTO departments(name) SELECT 'Scope option '||n FROM generate_series(1,105) n RETURNING id");
 const result=await admin.get('/api/custom-access/roles');assert.equal(result.status,200);
 assert.ok(result.body.departments.some(d=>d.id===depA));assert.ok(result.body.departments.some(d=>d.id===depB));
 for(const d of inserted.rows)assert.ok(result.body.departments.some(option=>option.id===Number(d.id)));
 assert.equal((await leader.get('/api/custom-access/roles')).status,403);
 await q('DELETE FROM departments WHERE id=ANY($1::bigint[])',[inserted.rows.map(d=>d.id)]);
});
