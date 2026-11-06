import ExcelJS from 'exceljs';
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
 const catalog=await leader.get('/api/reports');
 assert.equal(catalog.status,200);
 assert.deepEqual(catalog.body.items.map(report=>report.id),['daily-attendance','monthly-attendance','attendance-exceptions','employee-directory','department-headcount','employee-profile','employee-position-history','retirement-forecast']);
 assert.deepEqual((await plain.get('/api/reports')).body.items,[]);
 const previewPath='/api/reports/daily-attendance/preview';
 const filters='?date='+companyDate()+'&departmentId='+depA;
 const preview=await leader.get(previewPath+filters);
 const outsideFilters='?date='+companyDate()+'&departmentId='+depB;
 assert.equal((await leader.get(previewPath+outsideFilters)).body.total,0);
 assert.equal((await leader.get(previewPath+filters+'&employeeId='+outside.id)).body.total,0);
 const exportPath='/api/reports/daily-attendance/export.xlsx';
 const readExport=async query=>{
  const response=await leader.get(exportPath+query).buffer(true).parse((stream,done)=>{
   const chunks=[];
   stream.on('data',chunk=>chunks.push(chunk));
   stream.on('end',()=>done(null,Buffer.concat(chunks)));
   stream.on('error',done);
  });
  assert.equal(response.status,200);
  assert.match(response.headers['content-disposition'],/\.xlsx/);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  return workbook.getWorksheet('Attendance');
 };
 const sheet=await readExport(filters+'&page=2&pageSize=1');
 assert.equal(sheet.getCell('D3').value,preview.body.total);
 assert.deepEqual(sheet.getRows(5,preview.body.total).map(row=>row.getCell(1).value),preview.body.items.map(row=>row.employeeCode));
 assert.equal((await readExport(outsideFilters)).getCell('D3').value,0);
 assert.equal((await plain.get(exportPath+filters)).status,403);
 assert.equal((await leader.get(exportPath+filters+'&status=invalid')).status,400);
 const pdfPath='/api/reports/daily-attendance/export.pdf';
 const pdf=await leader.get(pdfPath+filters).buffer(true).parse((stream,done)=>{
  const chunks=[];
  stream.on('data',chunk=>chunks.push(chunk));
  stream.on('end',()=>done(null,Buffer.concat(chunks)));
  stream.on('error',done);
 });
 assert.equal(pdf.status,200);
 assert.match(pdf.headers['content-type'],/^application\/pdf/);
 assert.match(pdf.headers['content-disposition'],/\.pdf/);
 assert.equal(pdf.body.subarray(0,5).toString(),'%PDF-');
 assert.equal((await plain.get(pdfPath+filters)).status,403);
 assert.equal((await leader.get(pdfPath+filters+'&status=invalid')).status,400);

 assert.equal(preview.status,200,JSON.stringify(preview.body));
 assert.ok(preview.body.items.some(row=>row.id===recordA));
 assert.ok(preview.body.items.every(row=>row.departmentName==='A'));
 assert.equal(preview.body.total,preview.body.items.length);
 assert.equal((await plain.get(previewPath+'?date='+companyDate())).status,403);
 assert.equal((await leader.get(previewPath+'?date=invalid')).status,400);
 const month=companyDate().slice(0,7);
 const monthly='/api/reports/monthly-attendance';
 const monthFilters='?month='+month+'&departmentId='+depA;
 const byEmployee=await leader.get(monthly+'/preview'+monthFilters);
 assert.equal(byEmployee.status,200,JSON.stringify(byEmployee.body));
 assert.ok(byEmployee.body.items.some(row=>row.id===inside.id));
 assert.equal(byEmployee.body.items.reduce((sum,row)=>sum+row.total,0),preview.body.total);
 const department=await leader.get(monthly+'/preview'+monthFilters+'&groupBy=department');
 assert.equal(department.status,200,JSON.stringify(department.body));
 assert.equal(department.body.items.length,1);
 for(const key of ['present','late','absent','onLeave','incomplete','total']){
  assert.equal(department.body.items[0][key],byEmployee.body.items.reduce((sum,row)=>sum+row[key],0));
 }
 assert.equal((await leader.get(monthly+'/preview?month='+month+'&departmentId='+depB)).body.total,0);
 assert.equal((await leader.get(monthly+'/preview?month=2026-13')).status,400);
 for(const format of ['xlsx','pdf','docx']){
  const path=monthly+'/export.'+format+monthFilters+'&groupBy=department';
  const exported=await leader.get(path);
  assert.equal(exported.status,200,JSON.stringify(exported.body));
  assert.ok(exported.headers['content-disposition'].endsWith(month+'.'+format+'"'));
  assert.equal((await plain.get(path)).status,403);
 }

 const range='?from='+companyDate()+'&to='+companyDate();
 const exceptions='/api/reports/attendance-exceptions';
 const absences=await leader.get(exceptions+'/preview'+range+'&kind=absent');
 assert.equal(absences.status,200,JSON.stringify(absences.body));
 assert.ok(absences.body.items.some(row=>row.id===recordA&&row.exception==='Absence'));
 assert.ok(absences.body.items.every(row=>row.departmentName==='A'));
 assert.equal((await leader.get(exceptions+'/preview'+range+'&departmentId='+depB)).body.total,0);
 assert.equal((await leader.get(exceptions+'/preview?from=2026-01-02&to=2026-01-01')).status,400);
 for(const format of ['xlsx','pdf','docx']){
  assert.equal((await leader.get(exceptions+'/export.'+format+range)).status,200);
  assert.equal((await plain.get(exceptions+'/export.'+format+range)).status,403);
 }
 assert.equal((await leader.get('/api/reports/attendance-corrections/preview'+range)).status,403);
 const directory=await leader.get('/api/reports/employee-directory/preview?departmentId='+depA);
 assert.equal(directory.status,200,JSON.stringify(directory.body));
 assert.equal(directory.body.total,e.body.total);
 assert.ok(directory.body.items.every(row=>row.departmentName==='A'&&!Object.hasOwn(row,'email')));
 const headcount=await leader.get('/api/reports/department-headcount/preview?departmentId='+depA);
 assert.equal(headcount.status,200,JSON.stringify(headcount.body));
 assert.equal(headcount.body.items[0].total,directory.body.total);
 const reportLookups=await leader.get('/api/reports/employee-lookups');
 assert.ok(reportLookups.body.employees.every(row=>Number(row.departmentId)===depA));
 const profilePath='/api/reports/employee-profile';
 const profile=await leader.get(profilePath+'/preview?employeeId='+inside.id);
 assert.equal(profile.status,200,JSON.stringify(profile.body));
 assert.ok(profile.body.items.some(row=>row.label==='Name'&&row.value==='inside.employee'));
 assert.equal((await leader.get(profilePath+'/export.pdf?employeeId='+outside.id)).status,404);
 assert.equal((await leader.get(profilePath+'/export.docx?employeeId='+inside.id)).status,200);
 assert.equal((await leader.get(profilePath+'/export.pdf?employeeId='+inside.id)).status,200);
 assert.equal((await leader.get('/api/reports/employee-directory/export.xlsx?departmentId='+depA)).status,200);
 assert.equal((await plain.get(profilePath+'/preview?employeeId='+inside.id)).status,403);
 const positions=await leader.get('/api/reports/employee-position-history/preview?employeeId='+inside.id);
 assert.equal(positions.status,200,JSON.stringify(positions.body));
 assert.ok(positions.body.items.length);
 const forecast=await leader.get('/api/reports/retirement-forecast/preview?departmentId='+depA);
 assert.equal(forecast.status,200,JSON.stringify(forecast.body));
 assert.equal(forecast.body.total,(await leader.get('/api/retirement')).body.total);
 assert.equal((await leader.get('/api/reports/retirement-forecast/preview?departmentId='+depB)).body.total,0);
 const lookup=await leader.get('/api/attendance-records/lookups');assert.equal(lookup.status,200);assert.ok(lookup.body.employees.every(e=>Number(e.departmentId)===depA));
 assert.equal((await leader.get('/api/retirement')).body.total,3);
 assert.equal((await leader.get(`/api/employees/${outside.id}/attachments?direction=incoming`)).status,404);
 assert.equal((await leader.get(`/api/attendance-records/${recordB}/photos/check_in`)).status,404);
 assert.equal((await q('SELECT count(*)::int AS n FROM attendance_records WHERE employee_id=$1',[outsideManagerId])).rows[0].n,0);
 assert.equal((await leader.get('/api/dashboard')).status,403);assert.equal((await leader.get('/api/payroll/periods')).status,403);
 assert.equal((await leader.patch(`/api/attendance-records/${recordA}`).send({status:'absent',reason:'Follow up'})).status,403);
});
test('scoped activities reject company-wide additions and missing selections; definitions use optimistic versions',async()=>{
 assert.equal((await admin.put(`/api/custom-access/roles/${role.id}`).send({name:role.name,version:role.version,activities:['payroll.pay']})).status,400);
 const payroll=await newRole('Company Payroll Payment',['payroll.pay']);
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
 const range='?from='+companyDate()+'&to='+companyDate();
 const corrections='/api/reports/attendance-corrections';
 const history=await reviewer.get(corrections+'/preview'+range);
 assert.equal(history.status,200,JSON.stringify(history.body));
 assert.equal(history.body.total,1);
 assert.match(history.body.items[0].changes,/Status: absent to incomplete/);
 assert.match(history.body.items[0].modified,/team.leader/);
 assert.match(history.body.items[0].approved,/department.manager/);
 assert.equal((await outsider.get(corrections+'/preview'+range)).body.total,0);
 for(const format of ['xlsx','pdf']){
  assert.equal((await reviewer.get(corrections+'/export.'+format+range)).status,200);
  assert.equal((await plain.get(corrections+'/export.'+format+range)).status,403);
 }
 const missing=await reviewer.get('/api/reports/attendance-exceptions/preview'+range+'&kind=missingIn');
 assert.ok(missing.body.items.some(row=>row.id===recordA&&row.exception.includes('Missing check-in')));

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

let flexibleRole,leaveA,leaveB,annual,flexPeriod,entryA,entryB,deductionA,deductionB,applicationA,applicationB,vacancyId;
const scopeStatus=(res,status=200)=>assert.equal(res.status,status,JSON.stringify(res.body));
async function scopedApprove(response){scopeStatus(response,202);const id=response.body.requestId;
 const inbox=await reviewer.get('/api/change-requests');scopeStatus(inbox);assert.ok(inbox.body.items.some(r=>r.id===id&&r.canReview),JSON.stringify(inbox.body));
 scopeStatus(await outsider.get(`/api/change-requests/${id}`),404);
 const path='/api/reports/approvals-pending/preview';
 const scopedReport=await reviewer.get(path);scopeStatus(scopedReport);
 assert.ok(scopedReport.body.items.some(row=>Number(row.id)===id));
 const outsideReport=await outsider.get(path);scopeStatus(outsideReport);
 assert.ok(!outsideReport.body.items.some(row=>Number(row.id)===id));
 const result=await reviewer.post(`/api/change-requests/${id}/approve`).send({});scopeStatus(result);return result.body.applied?.body;
}
test('employee activities support department assignment with dependencies in existing sessions',async()=>{
 flexibleRole=await newRole('Flexible Department Manager',['salary_profiles.manage','leave.manage','deductions.manage','payroll.prepare','company_costs.read','dashboard.read','access.read','vacancies.review','changes.hr.approve','changes.finance.approve']);
 await assign(leaderId,flexibleRole.id,'departments',[depA]);await assign(reviewerId,flexibleRole.id,'departments',[depA]);await assign(outsideManagerId,flexibleRole.id,'departments',[depB]);
 const user=(await leader.get('/api/auth/me')).body.user;for(const p of ['payroll.read','employees.read','payroll_settings.read','organization.read','audit.finance'])assert.ok(user.permissions.includes(p));
 const deps=await leader.get('/api/departments');scopeStatus(deps);assert.deepEqual(deps.body.items.map(d=>d.id),[depA]);
 scopeStatus(await leader.get(`/api/departments/${depB}`),404);scopeStatus(await leader.get(`/api/departments/${depB}/positions`),404);
 const directory=await leader.get('/api/access-management/employees');scopeStatus(directory);assert.ok(directory.body.items.every(e=>e.department==='A'));
 scopeStatus(await leader.get(`/api/access-management/employees/${outside.id}/history`),404);
 scopeStatus(await leader.get('/api/payroll-settings/calculation'));scopeStatus(await leader.patch('/api/payroll-settings/calculation').send({companyPensionRate:12}),403);
});
test('leave requests, balances and immediate decisions respect scope; entitlement changes keep independent approval',async()=>{
 annual=Number((await q("SELECT id FROM leave_types WHERE code='annual'")).rows[0].id);
 for(const [emp,which]of[[inside,'a'],[outside,'b']]){const id=Number((await q("INSERT INTO leave_requests(employee_id,leave_type_id,start_date,end_date,days,reason) VALUES($1,$2,'2026-11-10','2026-11-10',1,'Scope test') RETURNING id",[emp.id,annual])).rows[0].id);if(which==='a')leaveA=id;else leaveB=id;}
 const list=await leader.get('/api/leave-admin/requests');scopeStatus(list);assert.ok(list.body.items.some(r=>r.id===leaveA));assert.ok(!list.body.items.some(r=>r.id===leaveB));
 scopeStatus(await leader.get(`/api/leave-admin/balances?employeeId=${outside.id}`),404);
 scopeStatus(await leader.post(`/api/leave-admin/requests/${leaveB}/approve`).send({}),404);
 scopeStatus(await leader.post(`/api/leave-admin/requests/${leaveA}/approve`).send({}),200);
 scopeStatus(await leader.post('/api/leave-admin/balances').send({employeeId:outside.id,leaveTypeId:annual,year:2026,entitledDays:25,reason:'Outside request'}),404);
 await scopedApprove(await leader.post('/api/leave-admin/balances').send({employeeId:inside.id,leaveTypeId:annual,year:2026,entitledDays:25,reason:'Department entitlement'}));
 const baseBalance=(await leader.get(`/api/leave-admin/balances?employeeId=${inside.id}&year=2026`)).body.items.find(b=>b.leaveTypeId===annual);
 assert.equal(baseBalance.entitled,25);
 const queryString=`?year=2026&employeeId=${inside.id}`;
 const balances=await leader.get('/api/reports/leave-balances/preview'+queryString);
 assert.equal(balances.status,200,JSON.stringify(balances.body));
 const reportBalance=balances.body.items.find(row=>row.leaveTypeName===baseBalance.name);
 for(const field of ['entitled','adjusted','used','pending','remaining']) assert.equal(reportBalance[field],baseBalance[field]);
 const usage=await leader.get('/api/reports/leave-usage/preview'+queryString+'&groupBy=department');
 assert.equal(usage.status,200,JSON.stringify(usage.body));
 assert.equal(usage.body.items.find(row=>row.leaveTypeName===baseBalance.name).used,baseBalance.used);
 const requests=await leader.get('/api/reports/leave-requests/preview'+queryString);
 assert.equal(requests.status,200,JSON.stringify(requests.body));
 assert.equal(requests.body.items.find(row=>row.id===leaveA).decidedBy,'team.leader');
 assert.equal((await leader.get(`/api/reports/leave-balances/preview?year=2026&employeeId=${outside.id}`)).body.total,0);
 for(const format of ['xlsx','pdf','docx']){
  const path='/api/reports/leave-usage/export.'+format+queryString;
  assert.equal((await leader.get(path)).status,200);
  assert.equal((await plain.get(path)).status,403);
 }

 const history=await leader.get('/api/audit-history?area=leave');scopeStatus(history);assert.ok(history.body.items.some(r=>r.type==='leave_request'&&Number(r.recordId)===leaveA));
 scopeStatus(await leader.get(`/api/audit-history/leave_request/${leaveB}`),404);
});
test('salary profiles and deductions enforce department scope on reads, mutations and approval queues',async()=>{
 await q('INSERT INTO salary_profiles(employee_id,basic_minor,allowance_minor) SELECT id,100000,10000 FROM employees ON CONFLICT(employee_id) DO NOTHING');
 const values={basicMinor:200000,allowanceMinor:10000,allowanceTaxable:true,allowancePensionable:false,pensionApplies:true};
 scopeStatus(await leader.get(`/api/salary-profiles/${outside.id}`),404);scopeStatus(await leader.put(`/api/salary-profiles/${outside.id}`).send(values),404);
 await scopedApprove(await leader.put(`/api/salary-profiles/${inside.id}`).send(values));
 assert.equal((await leader.get(`/api/salary-profiles/${inside.id}`)).body.basicMinor,200000);
 const item={employeeId:inside.id,kind:'loan',name:'Scoped deduction',amountMinor:1000,recurring:true,enabled:true};
 scopeStatus(await leader.post('/api/deductions').send({...item,employeeId:outside.id}),404);
 deductionA=(await scopedApprove(await leader.post('/api/deductions').send(item))).id;
 const outsideItem=await admin.post('/api/deductions').send({...item,employeeId:outside.id,name:'Outside deduction'});scopeStatus(outsideItem,201);deductionB=outsideItem.body.id;
 scopeStatus(await leader.get(`/api/deductions?employeeId=${outside.id}`),404);
 scopeStatus(await leader.patch(`/api/deductions/${deductionB}`).send({amountMinor:999}),404);scopeStatus(await leader.delete(`/api/deductions/${deductionB}`),404);
 await scopedApprove(await leader.patch(`/api/deductions/${deductionA}`).send({amountMinor:2000}));
 const audit=await leader.get('/api/audit-history?area=payroll');scopeStatus(audit);assert.ok(audit.body.items.some(r=>r.type==='deduction_item'&&Number(r.recordId)===deductionA));assert.ok(!audit.body.items.some(r=>r.type==='deduction_item'&&Number(r.recordId)===deductionB));
});
test('payroll entries, snapshots and exports are scoped; department managers edit entries but cannot regenerate company payroll',async()=>{
 await q('DELETE FROM income_tax_brackets');await q('INSERT INTO income_tax_brackets(from_minor,rate,fixed_deduction_minor) VALUES(0,10,0)');
 await q('UPDATE payroll_settings SET absence_deduction_enabled=false,unpaid_leave_deduction_enabled=false');
 const month=companyDate().slice(0,7);
 scopeStatus(await leader.post('/api/payroll/periods').send({month}),403);
 const draft=await admin.post('/api/payroll/periods').send({month});scopeStatus(draft,201);flexPeriod=draft.body.id;
 const all=await admin.get(`/api/payroll/periods/${flexPeriod}/entries`);scopeStatus(all);entryA=all.body.items.find(e=>e.employeeId===inside.id).id;entryB=all.body.items.find(e=>e.employeeId===outside.id).id;
 const reportsPath='/api/reports';
 const register=reportsPath+'/payroll-register';
 const payslip=reportsPath+'/employee-payslip';
 const deductions=reportsPath+'/payroll-deductions';
 const monthQuery='?month='+month;
 const ownQuery=monthQuery+'&employeeId='+inside.id;
 const outsideQuery=monthQuery+'&employeeId='+outside.id;
 scopeStatus(await leader.get(payslip+'/preview'+ownQuery),404);
 const list=await leader.get(`/api/payroll/periods/${flexPeriod}/entries?pageSize=1`);scopeStatus(list);assert.equal(list.body.total,(await q('SELECT count(*)::int n FROM employees WHERE department_id=$1',[depA])).rows[0].n);
 scopeStatus(await leader.get(`/api/payroll/periods/${flexPeriod}/entries/${entryB}`),404);
 scopeStatus(await leader.patch(`/api/payroll/periods/${flexPeriod}/entries/${entryB}`).send({basicMinor:222222}),404);
 scopeStatus(await leader.post(`/api/payroll/periods/${flexPeriod}/regenerate`).send({}),403);
 await scopedApprove(await leader.patch(`/api/payroll/periods/${flexPeriod}/entries/${entryA}`).send({basicMinor:222222}));
 scopeStatus(await admin.post(`/api/payroll/periods/${flexPeriod}/approve`).send({}));
 const period=await leader.get(`/api/payroll/periods/${flexPeriod}`);scopeStatus(period);assert.ok(period.body.configSnapshot.entries.some(e=>e.employeeId===inside.id));assert.ok(!period.body.configSnapshot.entries.some(e=>e.employeeId===outside.id));
 const csv=await leader.get(`/api/payroll/periods/${flexPeriod}/export.csv`);scopeStatus(csv);assert.ok(csv.text.includes('inside.employee'));assert.ok(!csv.text.includes('outside.employee'));
 scopeStatus(await admin.post(`/api/payroll/periods/${flexPeriod}/pay`).send({paidOn:companyDate()}));
 const costs=await leader.get('/api/payroll-costs');scopeStatus(costs);const visible=(await leader.get(`/api/payroll/periods/${flexPeriod}/entries`)).body.items;
 const stored=visible.find(row=>row.employeeId===inside.id);
 const registerResponse=await leader.get(register+'/preview'+monthQuery);
 scopeStatus(registerResponse);
 assert.equal(registerResponse.body.total,visible.length);
 assert.ok(registerResponse.body.items.every(row=>row.departmentName==='A'));
 const reported=registerResponse.body.items.find(row=>row.id===entryA);
 assert.equal(reported.net,stored.netMinor/100);
 assert.equal(reported.status,'paid');
 const amounts=await leader.get(deductions+'/preview'+ownQuery);
 scopeStatus(amounts);
 assert.equal(amounts.body.items.reduce((sum,row)=>sum+Math.round(row.amount*100),0),stored.grossMinor-stored.netMinor);
 const slip=await leader.get(payslip+'/preview'+ownQuery);
 scopeStatus(slip);
 assert.ok(slip.body.items.some(row=>row.label==='Net pay'&&row.value.startsWith((stored.netMinor/100).toFixed(2))));
 assert.equal((await leader.get(register+'/preview'+outsideQuery)).body.total,0);
 assert.equal((await leader.get(deductions+'/preview'+outsideQuery)).body.total,0);
 scopeStatus(await leader.get(payslip+'/export.pdf'+outsideQuery),404);
 for(const [path,format] of [[register,'xlsx'],[payslip,'pdf'],[deductions,'xlsx']]){
  const url=path+'/export.'+format+ownQuery;
  scopeStatus(await leader.get(url));
  scopeStatus(await plain.get(url),403);
 }
 // Editing a live profile cannot change a saved payroll report.
 await q('UPDATE salary_profiles SET basic_minor=basic_minor+100 WHERE employee_id=$1',[inside.id]);
 assert.deepEqual((await leader.get(register+'/preview'+monthQuery)).body,registerResponse.body);
 assert.deepEqual((await leader.get(payslip+'/preview'+ownQuery)).body,slip.body);
 await q('UPDATE salary_profiles SET basic_minor=basic_minor-100 WHERE employee_id=$1',[inside.id]);
 const cost=costs.body.items.find(c=>c.id===flexPeriod);assert.equal(cost.employeeCount,visible.length);assert.equal(cost.salaryPaidMinor,visible.reduce((sum,e)=>sum+e.netMinor,0));
 const detail=await leader.get(`/api/payroll-costs/${flexPeriod}/entries`);scopeStatus(detail);assert.ok(!detail.body.items.some(e=>e.employeeId===outside.id));
 const costReport=await leader.get('/api/reports/employer-cost-summary/preview'+monthQuery);
 scopeStatus(costReport);assert.equal(costReport.body.items[0].employerCost,cost.employerCostMinor/100);
 const costDetails=await leader.get('/api/reports/employer-cost-detail/preview'+monthQuery);
 scopeStatus(costDetails);assert.equal(costDetails.body.total,visible.length);
 assert.ok(costDetails.body.items.every(row=>row.departmentName==='A'));
 const excludedCost=await leader.get('/api/reports/employer-cost-detail/preview'+outsideQuery);
 scopeStatus(excludedCost);assert.equal(excludedCost.body.total,0);
 scopeStatus(await leader.get('/api/reports/settlement-balances/preview'+monthQuery),403);
 const audit=await leader.get('/api/audit-history?area=payroll');scopeStatus(audit);assert.ok(!audit.body.items.some(r=>r.type==='payroll_period'||r.type==='payroll_entry'&&Number(r.recordId)===entryB));
 scopeStatus(await leader.get(`/api/audit-history/payroll_period/${flexPeriod}`),403);
});
test('dashboard aggregates and recent rows use dashboard scope rather than broader employee viewing rights',async()=>{
 const dashboard=await leader.get('/api/dashboard');scopeStatus(dashboard);
 assert.equal(dashboard.body.stats.totalEmployees,(await q('SELECT count(*)::int n FROM employees WHERE department_id=$1',[depA])).rows[0].n);
 assert.ok(!JSON.stringify(dashboard.body).includes('outside.employee'));assert.ok(!JSON.stringify(dashboard.body).includes('other.manager'));
 const payroll=(await leader.get(`/api/payroll/periods/${flexPeriod}/entries`)).body.items;
 assert.equal(dashboard.body.payroll.totalMinor,payroll.reduce((sum,e)=>sum+e.netMinor,0));
 const periods=await outsider.get('/api/payroll/periods');scopeStatus(periods);assert.ok(periods.body.items.some(p=>p.id===flexPeriod));
});
test('vacancy application profiles, counts, reviews and audit stay inside applicant employee scope',async()=>{
 const position=Number((await q("INSERT INTO positions(department_id,name,basic_minor,allowance_minor) VALUES($1,'Scoped position',100000,0) RETURNING id",[depA])).rows[0].id);
 const job=await admin.post('/api/vacancies').send({title:'Scope vacancy',description:'',departmentId:depA,positionId:position,closingOn:'2099-12-31',status:'open'});scopeStatus(job,201);vacancyId=job.body.id;
 const a=await inside.client.post(`/api/vacancies/${vacancyId}/apply`).send({}),b=await outside.client.post(`/api/vacancies/${vacancyId}/apply`).send({});scopeStatus(a,201);scopeStatus(b,201);applicationA=a.body.id;applicationB=b.body.id;
 const jobs=await leader.get('/api/vacancies?view=manage');scopeStatus(jobs);assert.equal(jobs.body.items.find(v=>v.id===vacancyId).applicationCount,1);
 const list=await leader.get(`/api/vacancies/${vacancyId}/applications`);scopeStatus(list);assert.equal(list.body.total,1);assert.equal(list.body.items[0].id,applicationA);
 scopeStatus(await leader.get(`/api/vacancies/${vacancyId}/applications/${applicationB}`),404);
 scopeStatus(await leader.patch(`/api/vacancies/${vacancyId}/applications/${applicationB}`).send({status:'shortlisted',version:1}),404);
 await scopedApprove(await leader.patch(`/api/vacancies/${vacancyId}/applications/${applicationA}`).send({status:'shortlisted',version:1}));
 const reportPrefix='/api/reports/';
 const filters='?vacancyId='+vacancyId;
 const statusReport=await leader.get(reportPrefix+'vacancy-status/preview?status=open');scopeStatus(statusReport);
 assert.equal(statusReport.body.items.find(row=>row.vacancyId===vacancyId).applicationCount,1);
 const outcomes=await leader.get(reportPrefix+'vacancy-application-outcomes/preview'+filters+'&status=shortlisted');scopeStatus(outcomes);
 assert.equal(outcomes.body.total,1);assert.equal(outcomes.body.items[0].id,applicationA);
 assert.equal(outcomes.body.items[0].reviewedBy,'department.manager');
 assert.ok(!Object.hasOwn(outcomes.body.items[0],'profile_snapshot'));
 const summary=await leader.get(reportPrefix+'recruitment-summary/preview'+filters);scopeStatus(summary);
 assert.equal(summary.body.items[0].applications,1);assert.equal(summary.body.items[0].shortlisted,1);
 const adminSummary=await admin.get(reportPrefix+'recruitment-summary/preview'+filters);scopeStatus(adminSummary);
 assert.equal(adminSummary.body.items[0].applications,2);
 for(const [id,format] of [['vacancy-status','xlsx'],['vacancy-application-outcomes','pdf'],['recruitment-summary','docx']]){
  const path=reportPrefix+id+'/export.'+format+filters;
  scopeStatus(await leader.get(path));scopeStatus(await plain.get(path),403);
 }
 scopeStatus(await leader.get(`/api/audit-history/vacancy_application/${applicationB}`),404);
 const audit=await leader.get('/api/audit-history?area=vacancies');scopeStatus(audit);assert.ok(!audit.body.items.some(r=>Number(r.recordId)===applicationB));
});
test('broader reads do not widen writes and employee transfers immediately remove scoped access',async()=>{
 const readRole=await newRole('Broader Employee Reads',['leave.read','payroll.read','deductions.read']);await assign(leaderId,readRole.id,'all');
 const leave=await leader.get('/api/leave-admin/requests');scopeStatus(leave);assert.equal(leave.body.items.find(r=>r.id===leaveB).canManage,false);
 scopeStatus(await leader.post(`/api/leave-admin/requests/${leaveB}/reject`).send({remarks:'Not authorized'}),404);
 const salary=await leader.get(`/api/salary-profiles/${outside.id}`);scopeStatus(salary);assert.equal(salary.body.canManage,false);
 const deductions=await leader.get(`/api/deductions?employeeId=${outside.id}`);scopeStatus(deductions);assert.equal(deductions.body.canManage,false);
 scopeStatus(await leader.delete(`/api/deductions/${deductionB}`),404);
 // A still-pending scope-bound change cannot be applied after its employee transfers out.
 const proposal=await leader.patch(`/api/deductions/${deductionA}`).send({amountMinor:3000});scopeStatus(proposal,202);
 await q('UPDATE employees SET department_id=$1 WHERE id=$2',[depB,inside.id]);
 scopeStatus(await reviewer.get(`/api/change-requests/${proposal.body.requestId}`),404);
 const approved=await admin.post(`/api/change-requests/${proposal.body.requestId}/approve`).send({});assert.ok([404,409].includes(approved.status),JSON.stringify(approved.body));
 await q('UPDATE employees SET department_id=$1 WHERE id=$2',[depA,inside.id]);
});

test('individual employee scope works for the expanded activities without becoming department-wide',async()=>{
 const one=await person('single.employee.manager',depB);await assign(one.id,flexibleRole.id,'employees',[inside.id]);
 const client=one.client;
 const people=await client.get('/api/employees');scopeStatus(people);assert.deepEqual(people.body.items.map(e=>e.id),[inside.id]);
 const dashboard=await client.get('/api/dashboard');scopeStatus(dashboard);assert.equal(dashboard.body.stats.totalEmployees,1);
 scopeStatus(await client.get(`/api/salary-profiles/${outside.id}`),404);scopeStatus(await client.get(`/api/salary-profiles/${inside.id}`));
 scopeStatus(await client.get(`/api/leave-admin/balances?employeeId=${leaderId}`),404);
 const entries=await client.get(`/api/payroll/periods/${flexPeriod}/entries`);scopeStatus(entries);assert.deepEqual(entries.body.items.map(e=>e.employeeId),[inside.id]);
 const costs=await client.get('/api/payroll-costs');scopeStatus(costs);assert.equal(costs.body.items.find(p=>p.id===flexPeriod).employeeCount,1);
 const departments=await client.get('/api/departments');scopeStatus(departments);assert.deepEqual(departments.body.items.map(d=>d.id),[depA]);assert.equal(departments.body.items[0].employeeCount,1);
 const shifts=await client.get('/api/shifts');scopeStatus(shifts);assert.equal(shifts.body.items.find(s=>s.id===Number(shift)).employeeCount,1);
 const grants=await admin.get(`/api/custom-access/employees/${one.id}/custom-grants`);scopeStatus(grants);
 scopeStatus(await admin.post(`/api/custom-access/employees/${one.id}/custom-grants/${grants.body.items[0].id}/revoke`).send({reason:'End assignment'}),204);
 scopeStatus(await client.get(`/api/salary-profiles/${inside.id}`),403);
});

test('mixed roles can be assigned to departments; company-wide activities stay unavailable for that grant',async()=>{
 const limited=await person('mixed.department.manager',depA),unrestricted=await person('mixed.company.manager',depB);
 let mixed=await newRole('Mixed manager',['employees.manage','leave.manage','payroll.pay','payroll_settings.manage','organization.manage']);
 await assign(limited.id,mixed.id,'departments',[depA]);await assign(unrestricted.id,mixed.id,'all');
 const me=await limited.client.get('/api/auth/me');scopeStatus(me);
 for(const permission of ['employees.manage','leave.manage','leave.read'])assert.ok(me.body.user.permissions.includes(permission));
 for(const permission of ['payroll.pay','payroll_settings.manage','organization.manage','payroll.read','audit.finance'])assert.ok(!me.body.user.permissions.includes(permission),permission);
 scopeStatus(await limited.client.patch('/api/payroll-settings/calculation').send({companyPensionRate:13}),403);
 scopeStatus(await limited.client.post(`/api/payroll/periods/${flexPeriod}/pay`).send({paidOn:companyDate()}),403);
 scopeStatus(await limited.client.post('/api/departments').send({name:'Outside authority'}),403);
 scopeStatus(await limited.client.patch(`/api/employees/${inside.id}`).send({phone:'555111222'}),202);
 scopeStatus(await limited.client.patch(`/api/employees/${outside.id}`).send({phone:'555111222'}),404);
 const company=await unrestricted.client.get('/api/auth/me');scopeStatus(company);assert.ok(company.body.user.permissions.includes('payroll.pay'));assert.ok(company.body.user.permissions.includes('organization.manage'));
 const update=await admin.put(`/api/custom-access/roles/${mixed.id}`).send({name:mixed.name,version:mixed.version,activities:[...mixed.activities,'announcements.manage']});scopeStatus(update);mixed=update.body;
 assert.ok(!(await limited.client.get('/api/auth/me')).body.user.permissions.includes('announcements.manage'));
 assert.ok((await unrestricted.client.get('/api/auth/me')).body.user.permissions.includes('announcements.manage'));
 scopeStatus(await admin.put(`/api/custom-access/roles/${mixed.id}`).send({name:mixed.name,version:mixed.version,activities:['payroll.pay']}),400);
});

test('access reports distinguish role definitions, grant allowances, and overlapping effective scope', async () => {
 const subject = await person('access.review.subject', depA);
 const scoped = await newRole('Report review scoped', ['attendance.read', 'payroll.pay']);
 const other = await newRole('Report review other', ['attendance.read', 'attendance.qr']);
 const unrestricted = await newRole('Report review global', ['attendance.read']);
 const first = await assign(subject.id, scoped.id, 'departments', [depA, depB]);
 await assign(subject.id, other.id, 'departments', [depB]);
 const selected = await newRole('Report review selected', ['attendance.read']);
 await assign(subject.id, selected.id, 'employees', [inside.id]);
 const filters = '?employeeId=' + subject.id;
 const report = async (id, query = filters) => {
  const response = await admin.get('/api/reports/access-' + id + '/preview' + query);
  scopeStatus(response);
  return response.body.items;
 };
 const catalog = await admin.get('/api/reports');
 assert.equal(catalog.body.items.filter(item => item.group === 'Access administration').length, 4);
 assert.ok(!(await leader.get('/api/reports')).body.items.some(item => item.group === 'Access administration'));
 const defined = await report('role-permissions', '?search=Report%20review%20scoped');
 assert.equal(defined.find(row => row.permission === 'payroll.pay').source, 'Selected activity');
 assert.equal(defined.find(row => row.permission === 'payroll.read').source, 'Required by activity');
 const grants = await report('active-grants');
 assert.deepEqual(grants.filter(row => row.grantRef === 'Custom #' + first.id).map(row => row.target), ['A', 'B']);
 assert.ok((await report('active-grants', '?search=root')).some(row => row.roleName === 'admin'));
 const allowances = await report('grant-permissions');
 assert.equal(allowances.find(row => row.permission === 'payroll.pay').allowance, 'Excluded by scope');
 assert.ok(allowances.filter(row => row.permission === 'attendance.read').every(row => row.allowance === 'Allowed by grant'));
 const effectiveAttendance = async () => (await report('effective')).filter(row => row.permission === 'attendance.read');
 assert.deepEqual((await effectiveAttendance()).map(row => row.target), ['A', 'B', 'inside.employee (inside.employee)']);
 assert.ok(!(await report('effective')).some(row => row.permission === 'payroll.pay'));
 const global = await assign(subject.id, unrestricted.id, 'all');
 assert.deepEqual((await effectiveAttendance()).map(({ scope, target, grantCount }) => ({ scope, target, grantCount })),
  [{ scope: 'All employees', target: '', grantCount: 4 }]);
 scopeStatus(await admin.post(`/api/custom-access/employees/${subject.id}/custom-grants/${global.id}/revoke`).send({ reason: 'Review complete' }), 204);
 assert.equal((await effectiveAttendance()).length, 3);
 assert.ok(!(await report('active-grants')).some(row => row.grantRef === 'Custom #' + global.id));
 for (const format of ['xlsx', 'pdf', 'docx']) {
  const url = '/api/reports/access-effective/export.' + format + filters;
  const response = await admin.get(url);
  scopeStatus(response);
  assert.match(response.headers['content-disposition'], new RegExp('\\.' + format));
  scopeStatus(await leader.get(url), 403);
 }
 await q('UPDATE users SET is_active=false WHERE id=$1', [subject.userId]);
 assert.deepEqual(await report('effective'), []);
 assert.ok((await report('active-grants')).every(row => row.accountStatus === 'Inactive'));
});

test('appraisal grants keep viewing, review, approval and configuration separate', async () => {
 const path = '/api/appraisals/employees';
 const personWithGrants = await person('appraisal.manager', depA);
 const review = await newRole('Appraisal reviewer', ['appraisals.review']);
 const approve = await newRole('Appraisal approver', ['appraisals.approve']);
 const view = await newRole('Appraisal viewer', ['appraisals.read']);
 const configure = await newRole('Appraisal configuration', ['appraisals.configure']);
 const client = personWithGrants.client;
 scopeStatus(await client.get(path), 403);
 scopeStatus(await admin.post(`/api/custom-access/employees/${personWithGrants.id}/custom-grants`).send({
  roleId: configure.id, scopeType: 'departments', departmentIds: [depA], employeeIds: [],
 }), 400);
 await assign(personWithGrants.id, review.id, 'departments', [depA]);
 const scoped = await client.get(path);
 scopeStatus(scoped);
 assert.ok(scoped.body.items.length > 0);
 assert.ok(scoped.body.items.every(row => row.department === 'A' && row.canReview && !row.canApprove));
 assert.equal((await client.get(path + '?search=outside.employee')).body.total, 0);
 await assign(personWithGrants.id, approve.id, 'employees', [outside.id]);
 await assign(personWithGrants.id, view.id, 'all');
 const roster = await client.get(path + '?pageSize=100');
 scopeStatus(roster);
 const outsideRow = roster.body.items.find(row => row.id === outside.id);
 assert.equal(outsideRow.canReview, false);
 assert.equal(outsideRow.canApprove, true);
 const insideRow = roster.body.items.find(row => row.id === inside.id);
 assert.equal(insideRow.canReview, true);
 assert.equal(insideRow.canApprove, false);
 assert.ok(!Object.hasOwn(outsideRow, 'email'));
 const session = await client.get('/api/auth/me');
 assert.ok(!session.body.user.permissions.includes('appraisals.configure'));
 scopeStatus(await plain.get(path), 403);
});

test('cycle assignment rejects reviewers outside their department and opening requires a published match', async () => {
 const manager = await person('cycle.scope.reviewer', depA);
 const role = await newRole('Cycle scoped reviewer', ['appraisals.review']);
 await assign(manager.id, role.id, 'departments', [depA]);
 const created = await admin.post('/api/appraisals/cycles').send({
  name: 'Scope cycle', kind: 'custom', startsOn: '2026-10-01', endsOn: '2026-10-31', dueOn: '2026-11-15',
 });
 scopeStatus(created, 201);
 const path = `/api/appraisals/cycles/${created.body.id}`;
 scopeStatus(await admin.put(path + '/assignments').send({ version: 1, assignments: [{ employeeId: outside.id, reviewerId: manager.userId }] }), 400);
 scopeStatus(await admin.put(path + '/assignments').send({ version: 1, assignments: [{ employeeId: inside.id, reviewerId: manager.userId }] }), 204);
 const blocked = await admin.post(path + '/open').send({ version: 2 });
 scopeStatus(blocked, 422);
 assert.equal(blocked.body.error.code, 'missing_template');
 const draft = await admin.get(path + '/assignments');
 assert.equal(draft.body.cycle.openedAt, null);
 assert.equal(draft.body.items[0].templateVersion, null);
});
