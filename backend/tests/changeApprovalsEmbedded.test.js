import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/change_approvals_test';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');
const q=(s,p)=>db.query(s,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app,createApp}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{signIn}=await import('./hrClient.js');
const {approvalPolicy,leaveDecision}=await import('../src/services/approvalPolicy.js');
let admin,hr,hr2,fin,fin2,plain,root,shift,department,person,hrId,finId,period;
const creds=email=>({email,password:'password-123'});
const pending=async r=>{assert.equal(r.status,202,JSON.stringify(r.body));assert.equal(r.body.code,'approval_pending');return r.body.requestId;};
const approve=async(client,id)=>{const r=await client.post(`/api/change-requests/${id}/approve`).send({});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.status,'approved');};
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 root=(await seedAdmin({...creds('root@approval.test'),name:'Main Admin'})).id;admin=await signIn(app,creds('root@approval.test'));
 shift=(await admin.post('/api/shifts').send({name:'Day',startTime:'09:00',endTime:'17:00',workDays:[1,2,3,4,5],graceMinutes:0})).body.id;
 department=(await admin.post('/api/departments').send({name:'Original'})).body.id;
 for(const [code,role]of [['hr','hr'],['hr2','hr'],['fin','finance'],['fin2','finance'],['plain',null]]){
  const r=await admin.post('/api/employees').send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',employeeCode:code,fullName:code,username: code+'@approval.test', email:code+'@approval.test',password:'password-123',startDate:'2026-01-01',employmentType:'full_time',shiftId:shift,departmentId:department});assert.equal(r.status,201,JSON.stringify(r.body));if(code==='plain')person=r.body;if(code==='hr')hrId=r.body.userId;if(code==='fin')finId=r.body.userId;
  await q('UPDATE users SET must_change_password=false WHERE id=$1',[r.body.userId]);
  if(role)await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[r.body.userId,role,root]);
 }
 hr=await signIn(app,creds('hr@approval.test'));hr2=await signIn(app,creds('hr2@approval.test'));fin=await signIn(app,creds('fin@approval.test'));fin2=await signIn(app,creds('fin2@approval.test'));plain=await signIn(app,creds('plain@approval.test'));
});
after(async()=>db.close());
test('HR changes stay pending, are deduplicated, and need a different HR or Admin',async()=>{
 let r=await hr.patch(`/api/departments/${department}`).send({name:'Approved Dept'});const id=await pending(r);
 assert.equal((await q('SELECT name FROM departments WHERE id=$1',[department])).rows[0].name,'Original');
 assert.equal(await pending(await hr.patch(`/api/departments/${department}`).send({name:'Approved Dept'})),id);
 assert.equal((await hr.post(`/api/change-requests/${id}/approve`).send({})).status,403);
 assert.equal((await fin.post(`/api/change-requests/${id}/approve`).send({})).status,403);
 assert.equal((await plain.get('/api/change-requests')).status,403);
 await approve(hr2,id);
 assert.equal((await q('SELECT name FROM departments WHERE id=$1',[department])).rows[0].name,'Approved Dept');
 await approve(hr2,id); // retry does not apply twice
 assert.equal((await q("SELECT count(*)::int AS n FROM audit_logs WHERE action='department.update' AND entity_id=$1",[String(department)])).rows[0].n,1);
 const history=await hr.get(`/api/audit-history/department/${department}`);assert.equal(history.body.summary.modified.actor,'hr');assert.equal(history.body.summary.approved.actor,'hr2');
 assert.equal((await q('SELECT payload_cipher FROM change_requests WHERE id=$1',[id])).rows[0].payload_cipher,null);
});
test('Admin edits are immediate and approval inbox is paginated and department-scoped',async()=>{
 const r=await admin.patch(`/api/departments/${department}`).send({name:'Admin immediate'});assert.equal(r.status,200);
 const result=await hr.get('/api/change-requests?view=all');assert.equal(result.status,200);assert.equal(result.body.pageSize,20);assert.ok(result.body.items.every(x=>x.department==='hr'));
 const other=await fin.get('/api/change-requests?view=all');assert.ok(other.body.items.length>0);assert.ok(other.body.items.every(x=>!x.canReview));
 assert.equal((await hr.get('/api/change-requests?page=1.5')).status,400);
});
test('stale changes are refused; rejection and withdrawal never modify live records',async()=>{
 const id=await pending(await hr.patch(`/api/departments/${department}`).send({name:'Old proposed'}));
 await admin.patch(`/api/departments/${department}`).send({name:'Latest Admin'});
 let r=await hr2.post(`/api/change-requests/${id}/approve`).send({});assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(r.body.error.code,'stale_request');
 assert.equal((await hr.post(`/api/change-requests/${id}/cancel`).send({})).body.status,'cancelled');
 const rejected=await pending(await hr.patch(`/api/departments/${department}`).send({name:'Rejected'}));
 assert.equal((await hr2.post(`/api/change-requests/${rejected}/reject`).send({})).status,400);
 assert.equal((await hr2.post(`/api/change-requests/${rejected}/reject`).send({reason:'Incorrect department name'})).body.status,'rejected');
 assert.equal((await hr.get(`/api/change-requests/${rejected}`)).body.review_reason,'Incorrect department name');
 assert.equal((await q('SELECT name FROM departments WHERE id=$1',[department])).rows[0].name,'Latest Admin');
});
test('durable employee creation encrypts passwords and replays on a fresh app instance',async()=>{
 const body={gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',employeeCode:'new-person',fullName:'New person',username: 'new@approval.test', email:'new@approval.test',password:'temporary-private-password',startDate:'2026-01-01',employmentType:'full_time',shiftId:shift,departmentId:department};
 const id=await pending(await hr.post('/api/employees').send(body));
 const row=(await q('SELECT * FROM change_requests WHERE id=$1',[id])).rows[0];assert.ok(row.payload_cipher);assert.ok(!JSON.stringify(row).includes(body.password));assert.equal(row.payload_preview.password,'[protected]');
 assert.equal((await q('SELECT 1 FROM users WHERE email=$1',[body.email])).rows.length,0);
 const freshAdmin=await signIn(createApp({serveFrontend:false}),creds('root@approval.test'));await approve(freshAdmin,id);
 assert.equal((await q('SELECT 1 FROM users WHERE email=$1',[body.email])).rows.length,1);
});
test('operation failures roll back and keep requests pending; reviewers cannot replace the payload',async()=>{
 const id=await pending(await hr.post('/api/departments').send({name:'Latest Admin'})); // duplicate name
 const r=await hr2.post(`/api/change-requests/${id}/approve`).send({body:{name:'Injected'}});assert.equal(r.status,409,JSON.stringify(r.body));
 assert.equal((await q('SELECT status FROM change_requests WHERE id=$1',[id])).rows[0].status,'pending');
 assert.equal((await q("SELECT 1 FROM departments WHERE name='Injected'")).rows.length,0);
 await hr.post(`/api/change-requests/${id}/cancel`).send({});
});
test('Finance changes require a different Finance or Admin and respect requester revocation',async()=>{
 let id=await pending(await fin.put('/api/payroll-settings/brackets').send({items:[{fromMinor:0,toMinor:null,rate:10,fixedDeductionMinor:0}]}));
 assert.equal((await hr2.post(`/api/change-requests/${id}/approve`).send({})).status,403);
 await approve(fin2,id);assert.equal((await q('SELECT * FROM income_tax_brackets')).rows.length,1);
 id=await pending(await fin.patch('/api/payroll-settings/calculation').send({employeePensionRate:7}));
 await q("UPDATE access_grants SET revoked_at=now(),revoked_by_user_id=$2,revoke_reason='Changed assignment' WHERE user_id=$1 AND access_role='finance' AND revoked_at IS NULL",[finId,root]);
 const r=await admin.post(`/api/change-requests/${id}/approve`).send({});assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(r.body.error.code,'requester_unavailable');
 await admin.post(`/api/change-requests/${id}/reject`).send({reason:'Access revoked'});
 await q("INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,'finance',$2)",[finId,root]);
});
test('payroll generation, edits, regeneration, approval, payment and settlement all use review',async()=>{
 await q('INSERT INTO salary_profiles(employee_id,basic_minor,allowance_minor) SELECT id,200000,10000 FROM employees ON CONFLICT(employee_id) DO UPDATE SET basic_minor=200000,allowance_minor=10000');
 let id=await pending(await hr.post('/api/payroll/periods').send({month:'2026-06'}));await approve(hr2,id);
 period=Number((await q('SELECT id FROM payroll_periods')).rows[0].id);
 let entry=(await hr.get(`/api/payroll/periods/${period}/entries`)).body.items[0];
 id=await pending(await hr.patch(`/api/payroll/periods/${period}/entries/${entry.id}`).send({basicMinor:250000}));await approve(admin,id);
 id=await pending(await hr.post(`/api/payroll/periods/${period}/regenerate`).send({}));await approve(hr2,id);
 id=await pending(await fin.post(`/api/payroll/periods/${period}/approve`).send({}));await approve(fin2,id);
 assert.equal((await q('SELECT status FROM payroll_periods WHERE id=$1',[period])).rows[0].status,'approved');
 assert.equal(Number((await q('SELECT approved_by_user_id FROM payroll_periods WHERE id=$1',[period])).rows[0].approved_by_user_id),(await fin2.get('/api/auth/me')).body.user.id);
 id=await pending(await fin.post(`/api/payroll/periods/${period}/pay`).send({paidOn:'2026-06-30'}));await approve(admin,id);
 id=await pending(await fin.post(`/api/settlements/${period}/payments`).send({kind:'income_tax',amountMinor:1000,paymentDate:'2026-06-30',reference:'PAY-123',notes:'',requestId:randomUUID()}));await approve(fin2,id);
 assert.equal((await q('SELECT count(*)::int AS n FROM payroll_settlements')).rows[0].n,1);
});
test('daily actions and existing leave decisions are excluded; every admin write has a policy',async()=>{
 assert.equal(approvalPolicy('POST','/api/attendance/scan'),null);assert.equal(approvalPolicy('POST','/api/leave/requests'),null);assert.equal(leaveDecision('POST','/api/leave-admin/requests/1/approve'),true);
 let r=await hr.post('/api/leave-admin/requests/99999/reject').send({remarks:'Not applicable'});assert.equal(r.status,404,JSON.stringify(r.body));
 const families=[['POST','/api/employees'],['PATCH','/api/employees/1'],['POST','/api/employees/1/deactivate'],['POST','/api/departments'],['POST','/api/departments/1/positions'],['PATCH','/api/positions/1'],['POST','/api/shifts'],['PATCH','/api/attendance-records/1'],['POST','/api/leave-admin/balances'],['POST','/api/settings/holidays'],['PUT','/api/salary-profiles/1'],['POST','/api/announcements'],['PUT','/api/announcements/1'],['PUT','/api/payroll-settings/brackets'],['PATCH','/api/payroll-settings/calculation'],['PATCH','/api/payroll-settings/attendance-deductions'],['POST','/api/payroll-settings/other-taxes'],['POST','/api/deductions'],['POST','/api/payroll/periods'],['POST','/api/payroll/periods/1/regenerate'],['PATCH','/api/payroll/periods/1/entries/1'],['POST','/api/payroll/periods/1/approve'],['POST','/api/payroll/periods/1/pay'],['POST','/api/settlements/1/payments']];
 for(const [method,path]of families){const p=approvalPolicy(method,path);assert.ok(p,path);await q(`SELECT 1 FROM ${p.tables.join(',')} LIMIT 0`);}
 assert.equal((await plain.post('/api/departments').send({name:'Unauthorized'})).status,403);
});


test('an approval audit failure rolls back the business mutation and the decision together',async()=>{
 const before=(await q('SELECT name FROM departments WHERE id=$1',[department])).rows[0].name;
 const id=await pending(await hr.patch(`/api/departments/${department}`).send({name:'Must roll back'}));
 await db.exec("CREATE FUNCTION reject_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='change.approve' THEN RAISE EXCEPTION 'simulated audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_review_audit();");
 const r=await hr2.post(`/api/change-requests/${id}/approve`).send({});assert.equal(r.status,500);
 assert.equal((await q('SELECT name FROM departments WHERE id=$1',[department])).rows[0].name,before);
 assert.equal((await q('SELECT status FROM change_requests WHERE id=$1',[id])).rows[0].status,'pending');
 await db.exec('DROP TRIGGER fail_review_audit ON audit_logs; DROP FUNCTION reject_review_audit();');
 await approve(hr2,id);
});
test('proposals and final decisions are immutable at the database boundary',async()=>{
 const id=await pending(await hr.post('/api/departments').send({name:'Immutable proposal'}));
 await assert.rejects(q("UPDATE change_requests SET payload_preview='{}' WHERE id=$1",[id]),/immutable/);
 await hr.post(`/api/change-requests/${id}/cancel`).send({});
 await assert.rejects(q("UPDATE change_requests SET status='pending' WHERE id=$1",[id]),/immutable/);
 await assert.rejects(q('DELETE FROM change_requests WHERE id=$1',[id]),/cannot be deleted/);
});

test('approval and audit reports show scoped history and log successful downloads', async () => {
 const id = await pending(await hr.patch(`/api/departments/${department}`).send({ name: 'Report review change' }));
 const prefix = '/api/reports/';
 const pendingUrl = prefix + 'approvals-pending/preview?department=hr';
 const pendingReport = await hr.get(pendingUrl);
 assert.equal(pendingReport.status, 200, JSON.stringify(pendingReport.body));
 const request = pendingReport.body.items.find(row => Number(row.id) === id);
 assert.equal(request.requester, 'hr@approval.test');
 assert.match(request.requestedAt, /^\d{4}-\d{2}-\d{2}/);
 assert.ok(!Object.hasOwn(request, 'payload_preview'));
 assert.ok(!(await hr.get(prefix + 'approvals-pending/preview?from=2099-01-01')).body.items.some(row => Number(row.id) === id));
 await approve(hr2, id);
 assert.ok(!(await hr.get(pendingUrl)).body.items.some(row => Number(row.id) === id));
 const decisions = prefix + 'approval-decisions';
 const day = new Date().toISOString().slice(0, 10);
 const filters = '?department=hr&status=approved&from=' + day + '&to=' + day;
 const decided = await hr.get(decisions + '/preview' + filters);
 assert.equal(decided.status, 200, JSON.stringify(decided.body));
 const row = decided.body.items.find(item => Number(item.id) === id);
 assert.equal(row.reviewer, 'hr2@approval.test');
 assert.match(row.reviewedAt, /^\d{4}-\d{2}-\d{2}/);
 assert.equal((await plain.get(decisions + '/preview')).status, 403);
 const history = prefix + 'audit-change-history';
 const historyResult = await hr.get(history + '/preview?area=departments&to=' + day);
 assert.equal(historyResult.status, 200, JSON.stringify(historyResult.body));
 assert.ok(historyResult.body.items.some(item => item.action === 'department.update' && item.changes.includes('Report review change')));
 assert.equal((await fin.get(history + '/preview?area=departments')).status, 403);
 assert.equal((await hr.get(history + '/preview?from=2026-11-02&to=2026-11-01')).status, 400);
 for (const [path, format] of [[decisions, 'docx'], [decisions, 'xlsx'], [history, 'pdf']]) {
  const url = path + '/export.' + format + (path === history ? '?area=departments' : filters);
  const response = await hr.get(url);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.headers['content-disposition'], new RegExp('\\.' + format));
  assert.equal((await plain.get(url)).status, 403);
 }
 const { rows } = await q("SELECT * FROM audit_logs WHERE action='report.export' ORDER BY id");
 assert.equal(rows.length, 3);
 assert.ok(rows.every(entry => Number(entry.actor_user_id) === Number(hrId) && entry.occurred_at));
 assert.equal(rows[0].entity_id, 'approval-decisions');
 assert.deepEqual(rows[0].details.filters, { department: 'hr', status: 'approved', from: day, to: day });
 assert.equal(rows[0].details.format, 'docx');
 assert.equal(rows[2].details.report, 'audit-change-history');
});

test('position grades are approved, paginated, and copy pay only when assigned', async () => {
 const pos = await admin.post(`/api/departments/${department}/positions`).send({
  name: 'Graded Officer', basicMinor: 100000, allowanceMinor: 2000, allowanceTaxable: false,
 });
 assert.equal(pos.status, 201, JSON.stringify(pos.body));
 const positionId = pos.body.id;
 const grades = `/api/positions/${positionId}/grades`;
 const gradeBody = { name: 'Grade A', basicMinor: 220000, allowanceMinor: 16000 };
 const requestId = await pending(await hr.post(grades).send(gradeBody));
 assert.equal((await admin.get(grades)).body.total, 0);
 await approve(hr2, requestId);
 const [grade] = (await admin.get(grades)).body.items;
 assert.equal(grade.basicMinor, 220000);
 assert.equal((await plain.get(grades)).status, 403);
 assert.equal((await fin.post(grades).send({ ...gradeBody, name: 'Finance' })).status, 403);
 assert.equal((await admin.post(grades).send({ ...gradeBody, name: ' grade a ' })).status, 409);
 assert.equal((await admin.post(grades).send({ ...gradeBody, name: 'Invalid', basicMinor: -1 })).status, 400);

 const other = await admin.post(`/api/departments/${department}/positions`).send({
  name: 'Other grade position', basicMinor: 70000, allowanceMinor: 0,
 });
 const body = { employeeCode: 'graded-employee', fullName: 'Graded Employee', username: 'graded.employee',
  password: 'password-123', gender: 'male', dateOfBirth: '1990-01-01', fieldOfStudy: 'Economics',
  startDate: '2026-01-01', departmentId: Number(department), positionId, jobGradeId: grade.id };
 assert.equal((await admin.post('/api/employees').send({ ...body, positionId: other.body.id })).status, 400);
 const created = await admin.post('/api/employees').send(body);
 assert.equal(created.status, 201, JSON.stringify(created.body));
 assert.equal(created.body.jobGradeName, 'Grade A');
 const employeePath = '/api/employees/' + created.body.id;
 const pay = async () => (await admin.get(employeePath + '/salary-preview')).body;
 assert.equal((await pay()).basicMinor, 220000);
 assert.equal((await pay()).allowanceMinor, 16000);
 assert.equal((await pay()).allowanceTaxable, false);
 assert.equal((await admin.patch(`${grades}/${grade.id}`).send({ ...gradeBody, basicMinor: 310000 })).status, 200);
 assert.equal((await pay()).basicMinor, 220000);
 const otherGrade = await admin.post(grades).send({ name: 'Grade B', basicMinor: 280000, allowanceMinor: 20000 });
 assert.equal(otherGrade.status, 201);
 const changed = await admin.patch(employeePath).send({ jobGradeId: otherGrade.body.id, applyPositionSalary: true });
 assert.equal(changed.status, 200, JSON.stringify(changed.body));
 assert.equal(changed.body.jobGradeName, 'Grade B');
 assert.equal((await pay()).basicMinor, 280000);
 const payroll = await admin.post('/api/payroll/periods').send({ month: '2026-08' });
 assert.equal(payroll.status, 201, JSON.stringify(payroll.body));
 const entries = await admin.get(`/api/payroll/periods/${payroll.body.id}/entries`);
 const entry = entries.body.items.find(item => item.employeeId === created.body.id);
 assert.equal(entry.basicMinor, 280000);
 assert.equal(entry.allowanceMinor, 20000);
 assert.equal((await admin.patch(employeePath).send({ positionId: other.body.id })).body.jobGradeId, null);
 assert.equal((await pay()).basicMinor, 280000);
 await q(`INSERT INTO position_job_grades(position_id,name,basic_minor,allowance_minor)
  SELECT $1,'Scale '||n,100000,0 FROM generate_series(1,105) n`, [positionId]);
 const lastPage = await admin.get(grades + '?page=2&pageSize=100');
 assert.equal(lastPage.body.total, 107);
 assert.equal(lastPage.body.items.length, 7);
 assert.equal((await admin.get(grades + '?search=grade%20a')).body.total, 1);
});

test('new positions can include their first grade in the same approval request', async () => {
 const path = `/api/departments/${department}/positions`;
 const grade = { name: 'Level 1', basicMinor: 120000, allowanceMinor: 10000 };
 const body = { name: 'New position with grade', basicMinor: 100000, allowanceMinor: 0, initialGrade: grade };
 assert.equal((await hr.post(path).send({ ...body, initialGrade: { ...grade, basicMinor: -1 } })).status, 400);
 const id = await pending(await hr.post(path).send(body));
 assert.equal((await q('SELECT id FROM positions WHERE name=$1', [body.name])).rows.length, 0);
 await approve(hr2, id);
 const [position] = (await q('SELECT id FROM positions WHERE name=$1', [body.name])).rows;
 const response = await admin.get(`/api/positions/${position.id}/grades`);
 assert.equal(response.status, 200);
 assert.deepEqual(response.body.items.map(({ id, ...fields }) => fields), [grade]);
});

test('graded positions save multiple grades together and require a grade for employee assignment', async () => {
 const path = `/api/departments/${department}/positions`;
 const first = { name: 'Junior', basicMinor: 110000, allowanceMinor: 10000 };
 const second = { name: 'Senior', basicMinor: 210000, allowanceMinor: 20000 };
 const body = { name: 'Multi-grade position', basicMinor: 0, allowanceMinor: 0, initialGrades: [first, second] };
 assert.equal((await hr.post(path).send({ ...body, initialGrades: [] })).status, 400);
 assert.equal((await hr.post(path).send({ ...body, initialGrades: [first, { ...second, name: ' junior ' }] })).status, 400);
 const id = await pending(await hr.post(path).send(body));
 assert.equal((await q('SELECT id FROM positions WHERE name=$1', [body.name])).rows.length, 0);
 await approve(hr2, id);
 const positions = await admin.get(path + '?search=Multi-grade');
 const position = positions.body.items[0];
 assert.equal(position.requiresJobGrade, true);
 const grades = (await admin.get(`/api/positions/${position.id}/grades`)).body.items;
 assert.deepEqual(grades.map(({ id, ...grade }) => grade), [first, second]);

 const employee = { employeeCode: 'multi-grade', fullName: 'Multi Grade', username: 'multi.grade',
  password: 'password-123', gender: 'male', dateOfBirth: '1990-01-01', fieldOfStudy: 'Economics',
  startDate: '2026-01-01', departmentId: Number(department), positionId: position.id };
 assert.equal((await admin.post('/api/employees').send(employee)).status, 400);
 const created = await admin.post('/api/employees').send({ ...employee, jobGradeId: grades[1].id });
 assert.equal(created.status, 201, JSON.stringify(created.body));
 assert.equal(created.body.jobGradeName, 'Senior');
 assert.equal((await admin.patch(`/api/employees/${created.body.id}`).send({ jobGradeId: null })).status, 400);
});

test('appraisal templates respect scope precedence, flag ties and follow HR approval', async () => {
 const path = '/api/appraisals/templates';
 const roster = '/api/appraisals/employees?search=plain';
 const ok = async (response, status = 200) => {
  const r = await response; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body;
 };
 const create = body => ok(admin.post(path).send(body), 201);
 const match = async () => (await ok(admin.get(roster))).items.find(row => row.id === person.id).template;
 assert.deepEqual(await match(), { status: 'missing' });
 await ok(fin.get(path), 403);
 await ok(plain.get(roster), 403);
 await ok(admin.post(path).send({ name: 'Bad target', scope: 'department', targetId: 999999 }), 400);
 const request = await pending(await hr.post(path).send({ name: 'Company', scope: 'company' }));
 assert.deepEqual(await match(), { status: 'missing' });
 await approve(hr2, request);
 assert.equal((await match()).name, 'Company');
 await create({ name: 'Department', scope: 'department', targetId: Number(department) });
 assert.equal((await match()).name, 'Department');

 const position = await ok(admin.post(`/api/departments/${department}/positions`).send({
  name: 'Appraisal fixture', basicMinor: 100000, allowanceMinor: 0,
 }), 201);
 await ok(admin.patch(`/api/employees/${person.id}`).send({ positionId: position.id }));
 await create({ name: 'Position', scope: 'position', targetId: position.id });
 assert.equal((await match()).name, 'Position');
 const grade = await ok(admin.post(`/api/positions/${position.id}/grades`).send({
  name: 'Test grade', basicMinor: 110000, allowanceMinor: 1000,
 }), 201);
 await ok(admin.patch(`/api/employees/${person.id}`).send({ jobGradeId: grade.id }));
 const template = await create({ name: 'Grade', scope: 'grade', targetId: grade.id });
 assert.equal((await match()).name, 'Grade');
 const duplicate = await create({ name: 'Other grade template', scope: 'grade', targetId: grade.id });
 assert.deepEqual(await match(), { status: 'conflict', scope: 'grade', count: 2 });
 await ok(admin.delete(`${path}/${duplicate.id}`), 204);
 await ok(admin.patch(`${path}/${template.id}`).send({ ...template, name: 'Revised grade' }));
 assert.equal((await match()).name, 'Revised grade');
 await ok(admin.patch(`${path}/${template.id}`).send(template), 409);
 const targets = await ok(admin.get(path + '/targets?scope=grade&search=Test%20grade'));
 assert.equal(targets.items[0].id, grade.id);
});
