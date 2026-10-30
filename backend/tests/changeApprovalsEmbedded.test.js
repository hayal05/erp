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
  const r=await admin.post('/api/employees').send({employeeCode:code,fullName:code,username: code+'@approval.test', email:code+'@approval.test',password:'password-123',startDate:'2026-01-01',employmentType:'full_time',shiftId:shift,departmentId:department});assert.equal(r.status,201,JSON.stringify(r.body));if(code==='plain')person=r.body;if(code==='hr')hrId=r.body.userId;if(code==='fin')finId=r.body.userId;
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
 const body={employeeCode:'new-person',fullName:'New person',username: 'new@approval.test', email:'new@approval.test',password:'temporary-private-password',startDate:'2026-01-01',employmentType:'full_time',shiftId:shift,departmentId:department};
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
