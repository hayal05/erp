// Schema and real HTTP/approval flows in embedded PostgreSQL. Multi-connection
// throughput/races still need external PostgreSQL and deployment load tests.
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/vacancies_test';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');
const q=(s,p)=>db.query(s,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{signIn}=await import('./hrClient.js');
const {companyDate}=await import('../src/services/attendance.js');
const request=(await import('supertest')).default;
let admin,hr,hr2,finance,employee,other,root,department,position,people={};
const password='password-123',URL='/api/vacancies';
const posting=(extra={})=>({title:'Internal analyst',departmentId:department,positionId:position,closingOn:companyDate(),status:'open',description:'Internal opportunity',...extra});
const create=async(extra={})=>{const r=await admin.post(URL).send(posting(extra));assert.equal(r.status,201,JSON.stringify(r.body));return r.body.id;};
const approve=async id=>{const r=await admin.post(`/api/change-requests/${id}/approve`).send({});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.applied.body;};
const list=async client=>(await client.get(URL+'?view=manage')).body;
before(async()=>{
 const dir=new globalThis.URL('../../database/migrations/',import.meta.url);for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new globalThis.URL(f,dir),'utf8'));
 root=(await seedAdmin({username:'root',password})).id;admin=await signIn(app,{username:'root',password});
 const shift=(await admin.post('/api/shifts').send({name:'Day',startTime:'09:00',endTime:'17:00',workDays:[1,2,3,4,5],graceMinutes:0})).body.id;
 department=(await admin.post('/api/departments').send({name:'Operations'})).body.id;
 const pos=await admin.post(`/api/departments/${department}/positions`).send({name:'Analyst',basicMinor:100000,allowanceMinor:10000});assert.equal(pos.status,201,JSON.stringify(pos.body));position=pos.body.id;
 for(const [username,role]of[['hr','hr'],['hr2','hr'],['finance','finance'],['employee',null],['other',null]]){
  const r=await admin.post('/api/employees').send({username:username+'.user',employeeCode:username,fullName:username,password,startDate:'2020-01-01',shiftId:shift,departmentId:department,positionId:position,...(username==='employee'?{gender:'female',dateOfBirth:'1995-02-28',fieldOfStudy:'Economics'}:{})});assert.equal(r.status,201,JSON.stringify(r.body));people[username]=r.body;
  await q('UPDATE users SET must_change_password=false WHERE id=$1',[r.body.userId]);if(role)await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[r.body.userId,role,root]);
 }
 hr=await signIn(app,{username:'hr.user',password});hr2=await signIn(app,{username:'hr2.user',password});finance=await signIn(app,{username:'finance.user',password});employee=await signIn(app,{username:'employee.user',password});other=await signIn(app,{username:'other.user',password});
});
beforeEach(async()=>{
 await db.exec('TRUNCATE change_requests,audit_logs,vacancy_applications,internal_vacancies RESTART IDENTITY CASCADE');
 await q("UPDATE employees SET experience_summary='Operations experience',phone='0911111111' WHERE id=$1",[people.employee.id]);
});
after(async()=>db.close());

test('posting follows HR approval, while Admin posting is immediate; Finance is read-only',async()=>{
 const proposed=await hr.post(URL).send(posting());assert.equal(proposed.status,202,JSON.stringify(proposed.body));assert.equal((await list(admin)).total,0);
 assert.equal((await hr.post(`/api/change-requests/${proposed.body.requestId}/approve`).send({})).status,403);
 assert.equal((await finance.post(`/api/change-requests/${proposed.body.requestId}/approve`).send({})).status,403);
 await approve(proposed.body.requestId);assert.equal((await employee.get(URL)).body.total,1);
 await create({title:'Immediate posting'});assert.equal((await list(finance)).total,2);
 assert.equal((await finance.post(URL).send(posting())).status,403);
 assert.equal((await employee.post(URL).send(posting())).status,403);
 assert.equal((await request(app).get(URL)).status,401);
});
test('one-click apply uses only the signed-in employee profile, freezes its history, and rejects duplicates',async()=>{
 const id=await create();
 const applied=await employee.post(`${URL}/${id}/apply`).send({employeeId:people.other.id,profile:{fullName:'Forged'},status:'selected',cv:'ignored'});assert.equal(applied.status,201,JSON.stringify(applied.body));
 assert.equal((await employee.post(`${URL}/${id}/apply`).send({})).status,409);
 const rows=(await q('SELECT * FROM vacancy_applications')).rows;assert.equal(rows.length,1);assert.equal(Number(rows[0].employee_id),people.employee.id);
 const snapshot=rows[0].profile_snapshot;assert.equal(snapshot.fullName,'employee');assert.equal(snapshot.gender,'female');assert.equal(snapshot.dateOfBirth,'1995-02-28');assert.equal(snapshot.fieldOfStudy,'Economics');assert.equal(snapshot.phone,'0911111111');assert.equal(snapshot.experienceSummary,'Operations experience');assert.ok(snapshot.positionHistory.length);
 const text=JSON.stringify(snapshot);assert.doesNotMatch(text,/password|salary|basicMinor|allowanceMinor|accessRoles|photo/);
 await q("UPDATE employees SET experience_summary='Changed later',phone='0922222222' WHERE id=$1",[people.employee.id]);
 const detail=await hr.get(`${URL}/${id}/applications/${applied.body.id}`);assert.equal(detail.status,200);assert.deepEqual(detail.body.profile,snapshot);
 await assert.rejects(q("UPDATE vacancy_applications SET profile_snapshot='{}'::jsonb WHERE id=$1",[applied.body.id]),/cannot be changed/);
 const mine=await employee.get(URL+'?view=mine');assert.equal(mine.body.items[0].applicationId,applied.body.id);assert.equal(mine.body.items[0].applicationStatus,'applied');
 assert.equal((await other.get(URL+'?view=mine')).body.total,0);
 const footer=await admin.get('/api/audit-history?area=vacancies');assert.equal(footer.body.summary.modified.type,'vacancy');assert.deepEqual(footer.body.summary.approved,footer.body.summary.modified);
 assert.equal((await admin.delete(`/api/positions/${position}`)).status,409);
});
test('employee visibility and deadlines cannot be bypassed with query parameters or direct submission',async()=>{
 const open=await create(),draft=await create({status:'draft'}),closed=await create({status:'closed'}),expired=await create({title:'Expired'});
 await q("UPDATE internal_vacancies SET closing_on='2000-01-01' WHERE id=$1",[expired]);
 const visible=await employee.get(URL+'?status=draft');assert.equal(visible.body.total,1);assert.equal(visible.body.items[0].id,open);
 assert.equal((await employee.get(URL+'?view=manage')).status,403);
 for(const id of[draft,closed,expired,999999])assert.equal((await employee.post(`${URL}/${id}/apply`).send({})).status,409);
 assert.equal((await admin.post(URL).send(posting({closingOn:'2000-01-01'}))).status,422);
 assert.equal((await admin.post(URL).send(posting({departmentId:999999}))).status,422);
 assert.equal((await q('SELECT count(*)::int n FROM vacancy_applications')).rows[0].n,0);
});
test('reviewer profile access is HR/Admin only and application status changes require approval',async()=>{
 const id=await create(),a=await employee.post(`${URL}/${id}/apply`).send({});assert.equal(a.status,201);
 for(const client of[employee,other,finance]){
  assert.equal((await client.get(`${URL}/${id}/applications`)).status,403);
  assert.equal((await client.get(`${URL}/${id}/applications/${a.body.id}`)).status,403);
  assert.equal((await client.patch(`${URL}/${id}/applications/${a.body.id}`).send({status:'selected',version:1})).status,403);
 }
 const submitted=await hr.patch(`${URL}/${id}/applications/${a.body.id}`).send({status:'shortlisted',version:1});assert.equal(submitted.status,202,JSON.stringify(submitted.body));
 assert.equal((await hr.get(`${URL}/${id}/applications/${a.body.id}`)).body.status,'applied');
 await approve(submitted.body.requestId);
 const reviewed=(await hr.get(`${URL}/${id}/applications`)).body.items[0];assert.equal(reviewed.status,'shortlisted');assert.equal(reviewed.reviewedBy,'root');assert.ok(reviewed.reviewedAt);
 const stale=await admin.patch(`${URL}/${id}/applications/${a.body.id}`).send({status:'selected',version:1});assert.equal(stale.status,409);
 const selected=await admin.patch(`${URL}/${id}/applications/${a.body.id}`).send({status:'selected',version:2});assert.equal(selected.status,200);
 assert.equal((await employee.get(URL+'?view=mine')).body.items[0].applicationStatus,'selected');
 const audit=await admin.get('/api/audit-history?area=vacancies');assert.equal(audit.status,200);assert.ok(audit.body.items.some(r=>r.action==='vacancy.application.review'));assert.doesNotMatch(JSON.stringify(audit.body),/Operations experience|0911111111/);
});
test('vacancy closing, existing applications and optimistic versions preserve recruitment history',async()=>{
 const id=await create();await employee.post(`${URL}/${id}/apply`).send({});
 assert.equal((await admin.put(`${URL}/${id}`).send(posting({title:'Different role',version:1}))).status,409);
 assert.equal((await admin.put(`${URL}/${id}`).send(posting({status:'draft',version:1}))).status,409);
 assert.equal((await admin.put(`${URL}/${id}`).send(posting({status:'closed',version:1}))).status,200);
 assert.equal((await other.post(`${URL}/${id}/apply`).send({})).status,409);
 assert.equal((await employee.get(URL+'?view=mine')).body.total,1);
 assert.equal((await admin.put(`${URL}/${id}`).send(posting({version:1}))).status,409);
 assert.equal((await hr.get(`${URL}/${id}/applications?pageSize=1`)).body.total,1);
});
test('same-department reviewer can authorize a vacancy and review decisions; profiles remain private on shared reads',async()=>{
 let pending=await hr.post(URL).send(posting({status:'draft'}));assert.equal(pending.status,202);
 const decision=await hr2.post(`/api/change-requests/${pending.body.requestId}/approve`).send({});assert.equal(decision.status,200,JSON.stringify(decision.body));
 const draft=decision.body.applied.body.id;
 assert.equal((await employee.get(URL)).body.total,0);
 const financeList=await finance.get(URL+'?view=manage');assert.equal(financeList.status,200);assert.equal(financeList.body.items[0].id,draft);assert.doesNotMatch(JSON.stringify(financeList.body),/profile_snapshot|Operations experience/);
 const job=await create();pending=await employee.post(`${URL}/${job}/apply`).send({});assert.equal(pending.status,201,'employee action is never queued');
 const proposal=await hr.patch(`${URL}/${job}/applications/${pending.body.id}`).send({status:'rejected',version:1});assert.equal(proposal.status,202);
 const reviewed=await hr2.post(`/api/change-requests/${proposal.body.requestId}/approve`).send({});assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
 assert.equal((await hr.get(`${URL}/${job}/applications`)).body.items[0].reviewedBy,'hr2.user');
});


test('new applications do not invalidate a pending review, but changes to the reviewed application do',async()=>{
 const id=await create(),applied=await employee.post(`${URL}/${id}/apply`).send({});
 let pending=await hr.patch(`${URL}/${id}/applications/${applied.body.id}`).send({status:'shortlisted',version:1});assert.equal(pending.status,202);
 assert.equal((await other.post(`${URL}/${id}/apply`).send({})).status,201);
 await approve(pending.body.requestId);
 pending=await hr.patch(`${URL}/${id}/applications/${applied.body.id}`).send({status:'selected',version:2});assert.equal(pending.status,202);
 assert.equal((await admin.patch(`${URL}/${id}/applications/${applied.body.id}`).send({status:'rejected',version:2})).status,200);
 const stale=await admin.post(`/api/change-requests/${pending.body.requestId}/approve`).send({});assert.equal(stale.status,409);assert.equal(stale.body.error.code,'stale_request');
 const another=await create();assert.equal((await hr.get(`${URL}/${another}/applications/${applied.body.id}`)).status,404);
});

test('vacancy and applicant pagination preserve totals and never mix employee applications',async()=>{
 const ids=[];for(let i=0;i<3;i++)ids.push(await create({title:'Opening '+i}));
 const a=await employee.get(URL+'?pageSize=1&page=1'),b=await employee.get(URL+'?pageSize=1&page=2');assert.equal(a.body.total,3);assert.equal(b.body.items.length,1);assert.notEqual(a.body.items[0].id,b.body.items[0].id);
 for(const client of[employee,other])assert.equal((await client.post(`${URL}/${ids[0]}/apply`).send({})).status,201);
 const applicants=await hr.get(`${URL}/${ids[0]}/applications?pageSize=1&page=2`);assert.equal(applicants.body.total,2);assert.equal(applicants.body.items.length,1);
 assert.equal((await employee.get(URL+'?view=mine')).body.total,1);
});

test('unopened vacancy counts are personal, persist across sessions and clear only when opened or applied',async()=>{
 const a=await create(),b=await create({title:'Second new vacancy'});
 const count=async client=>(await client.get(URL+'/unread-count')).body.unreadCount;
 assert.equal(await count(employee),2);assert.equal(await count(other),2);
 let feed=await employee.get(URL);assert.ok(feed.body.items.every(item=>item.unopened));
 // Merely loading the feed must not mark every vacancy as opened.
 assert.equal(await count(employee),2);
 const opened=await employee.post(`${URL}/${a}/open`).send({employeeId:people.other.id});assert.equal(opened.status,200,JSON.stringify(opened.body));
 assert.equal(await count(employee),1);assert.equal(await count(other),2);
 const first=(await q('SELECT opened_at FROM vacancy_views WHERE vacancy_id=$1 AND employee_id=$2',[a,people.employee.id])).rows[0].opened_at;
 assert.equal((await employee.post(`${URL}/${a}/open`).send({})).status,200);
 const receipts=await q('SELECT opened_at FROM vacancy_views WHERE vacancy_id=$1 AND employee_id=$2',[a,people.employee.id]);assert.equal(receipts.rows.length,1);assert.deepEqual(receipts.rows[0].opened_at,first);
 const secondDevice=await signIn(app,{username:'employee.user',password});assert.equal(await count(secondDevice),1);
 feed=await secondDevice.get(URL);assert.equal(feed.body.items.find(item=>item.id===a).unopened,false);assert.equal(feed.body.items.find(item=>item.id===b).unopened,true);
 assert.equal((await employee.post(`${URL}/${b}/apply`).send({})).status,201);assert.equal(await count(employee),0);assert.equal(await count(other),2);
 // Existing applications from before read receipts were introduced must not become "new".
 await q('DELETE FROM vacancy_views WHERE vacancy_id=$1 AND employee_id=$2',[b,people.employee.id]);assert.equal(await count(employee),0);
});

test('the counter excludes drafts, closed and expired postings, and read marks cannot bypass visibility',async()=>{
 const open=await create(),draft=await create({status:'draft'}),closed=await create({status:'closed'}),expired=await create({title:'Expired vacancy'});
 await q("UPDATE internal_vacancies SET closing_on='2000-01-01' WHERE id=$1",[expired]);
 const endpoint=URL+'/unread-count';assert.equal((await employee.get(endpoint+'?employeeId='+people.other.id)).body.unreadCount,1);
 for(const id of[draft,closed,expired,999999])assert.equal((await employee.post(`${URL}/${id}/open`).send({})).status,404);
 assert.equal((await q('SELECT count(*)::int n FROM vacancy_views')).rows[0].n,0);
 assert.equal((await request(app).get(endpoint)).status,401);assert.equal((await admin.get(endpoint)).status,403);
 assert.equal((await employee.post(`${URL}/${open}/open`).send({})).status,200);
 assert.equal((await admin.put(`${URL}/${open}`).send(posting({status:'closed',version:1}))).status,200);
 assert.equal((await other.get(endpoint)).body.unreadCount,0);
 assert.equal((await admin.put(`${URL}/${open}`).send(posting({status:'open',version:2}))).status,200);
 assert.equal((await employee.get(endpoint)).body.unreadCount,0,'an already opened vacancy stays read when reopened');
 assert.equal((await other.get(endpoint)).body.unreadCount,1,'another employee still has not opened it');
});
