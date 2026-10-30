import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/audit_history_test';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');const q=(s,p)=>db.query(s,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{signIn,signInWithReviewer}=await import('./hrClient.js'),{companyDate}=await import('../src/services/attendance.js');
const request=(await import('supertest')).default;
let admin,hr,finance,plain,person,department,period,root;
const creds=email=>({email,password:'password-123'});
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 root=(await seedAdmin({...creds('root@audit.test'),name:'Main Admin'})).id;admin=await signIn(app,creds('root@audit.test'));
 const shift=(await admin.post('/api/shifts').send({name:'Day',startTime:'09:00',endTime:'17:00',workDays:[1,2,3,4,5],graceMinutes:0})).body.id;
 department=(await admin.post('/api/departments').send({name:'Audit Dept'})).body.id;
 for(const [code,role]of [['hr','hr'],['finance','finance'],['plain',null]]){
  const r=await admin.post('/api/employees').send({employeeCode:code,fullName:code,username: code+'@audit.test', email:code+'@audit.test',password:'password-123',startDate:'2026-01-01',employmentType:'full_time',shiftId:shift,departmentId:department});assert.equal(r.status,201);if(code==='plain')person=r.body;
  await q('UPDATE users SET must_change_password=false WHERE id=$1',[r.body.userId]);
  if(role)await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[r.body.userId,role,root]);
 }
 hr=await signInWithReviewer(app,creds('hr@audit.test'),admin);finance=await signInWithReviewer(app,creds('finance@audit.test'),admin);plain=await signIn(app,creds('plain@audit.test'));
});
after(async()=>db.close());
test('history checks domain and record permissions; employees cannot read even their own admin history',async()=>{
 const url=`/api/audit-history/employee/${person.id}`;
 assert.equal((await request(app).get(url)).status,401);assert.equal((await plain.get(url)).status,403);assert.equal((await finance.get(url)).status,403);
 assert.equal((await hr.get(url)).status,200);assert.equal((await hr.get(`/api/audit-history/access_employee/${person.id}`)).status,403);
 assert.equal((await admin.get('/api/audit-history/not_a_type/1')).status,400);assert.equal((await hr.get('/api/audit-history/employee/99999')).status,404);
 assert.equal((await hr.get(url+'?pageSize=1000')).status,400);
});
test('modification actor/date and permitted before/after fields are shown without raw payloads or secrets',async()=>{
 await admin.patch(`/api/employees/${person.id}`).send({phone:'0911111111'});
 await q("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'employee.update','employee',$2,$3::jsonb)",[root,String(person.id),JSON.stringify({changes:{phone:{from:'0911111111',to:'0922222222'},password_hash:{from:'SECRET-HASH',to:'SECRET-NEW'},role:{from:'employee',to:'admin'}},session:'SESSION-SECRET',csrfToken:'TOKEN-SECRET'})]);
 const r=await hr.get(`/api/audit-history/employee/${person.id}`);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.summary.created.actor,'Main Admin');assert.equal(r.body.summary.modified.actor,'Main Admin');assert.equal(r.body.summary.approved,null);
 const text=JSON.stringify(r.body);assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('password_hash'));assert.deepEqual(r.body.items[0].changes,[{field:'phone',from:'0911111111',to:'0922222222'}]);
 const next=await hr.get(`/api/audit-history/employee/${person.id}?pageSize=1&page=2`);assert.equal(next.body.total,r.body.total);assert.notEqual(next.body.items[0].id,r.body.items[0].id);
});
test('unrecorded metadata remains empty rather than fabricated',async()=>{
 const d=(await q("INSERT INTO departments(name) VALUES('Legacy without log') RETURNING id")).rows[0].id;
 const r=await hr.get(`/api/audit-history/department/${d}`);assert.equal(r.status,200);assert.equal(r.body.total,0);assert.deepEqual(r.body.summary,{created:null,modified:null,approved:null});
});
test('payroll history includes old entry edits after regeneration, approval and payment with pagination',async()=>{
 await q('INSERT INTO salary_profiles(employee_id,basic_minor,allowance_minor) SELECT id,200000,10000 FROM employees');
 await q('INSERT INTO income_tax_brackets(from_minor,rate,fixed_deduction_minor) VALUES(0,10,0)');
 let r=await hr.post('/api/payroll/periods').send({month:'2026-06'});assert.equal(r.status,201,JSON.stringify(r.body));period=r.body.id;
 const entry=(await hr.get(`/api/payroll/periods/${period}/entries`)).body.items[0];
 await hr.patch(`/api/payroll/periods/${period}/entries/${entry.id}`).send({basicMinor:250000});
 await hr.post(`/api/payroll/periods/${period}/regenerate`).send({});
 assert.equal((await finance.post(`/api/payroll/periods/${period}/approve`).send({})).status,200);
 await finance.post(`/api/payroll/periods/${period}/pay`).send({paidOn:'2026-06-30'});
 r=await finance.get(`/api/audit-history/payroll_period/${period}`);assert.equal(r.status,200,JSON.stringify(r.body));
 for(const action of ['payroll.period.generate','payroll.entry.recalculate','payroll.period.regenerate','payroll.period.approve','payroll.period.pay'])assert.ok(r.body.items.some(x=>x.action===action),action);
 assert.equal(r.body.summary.approved.actor,'Main Admin');assert.equal(r.body.summary.created.actor,'hr');assert.equal(r.body.summary.modified.actor,'hr');
 assert.equal((await hr.get(`/api/audit-history/payroll_period/${period}`)).status,200);
 const page=await finance.get(`/api/audit-history/payroll_period/${period}?pageSize=2&page=2`);assert.equal(page.body.items.length,2);assert.equal(page.body.total,10);
});
test('settings, access and settlement histories keep separate permissions and records',async()=>{
 assert.equal((await finance.get('/api/audit-history/payroll_settings/1')).status,200);
 assert.equal((await finance.get(`/api/audit-history/access_employee/${person.id}`)).status,403);
 assert.equal((await admin.get(`/api/audit-history/access_employee/${person.id}`)).status,200);
 let r=await finance.post(`/api/settlements/${period}/payments`).send({kind:'income_tax',amountMinor:1000,paymentDate:companyDate(),reference:'PAY-123',notes:'',requestId:randomUUID()});assert.equal(r.status,201,JSON.stringify(r.body));
 r=await finance.get(`/api/audit-history/settlement_period/${period}`);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.total,2);assert.ok(r.body.items.some(item=>item.changes.some(c=>c.field==='reference'&&c.value==='PAY-123')));
 assert.equal((await hr.get(`/api/audit-history/settlement_period/${period}`)).status,403);
});

test('section audit feeds enforce domain permissions and never expose raw details',async()=>{
 assert.equal((await request(app).get('/api/audit-history?area=employees')).status,401);
 assert.equal((await plain.get('/api/audit-history?area=employees')).status,403);
 assert.equal((await finance.get('/api/audit-history?area=employees')).status,403);
 assert.equal((await hr.get('/api/audit-history?area=access')).status,403);
 assert.equal((await hr.get('/api/audit-history?area=settlements')).status,403);
 assert.equal((await admin.get('/api/audit-history?area=not_real')).status,400);
 assert.equal((await admin.get('/api/audit-history?area=all&pageSize=1000')).status,400);
 let r=await hr.get('/api/audit-history?area=employees&pageSize=1');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items.length,1);assert.equal(r.body.pageSize,1);assert.equal(r.headers['cache-control'],'no-store');
 const text=JSON.stringify(r.body);assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('password_hash'));assert.ok(!text.includes('details'));
 const next=await hr.get('/api/audit-history?area=employees&pageSize=1&page=2');assert.equal(next.status,200);assert.notEqual(next.body.items[0].id,r.body.items[0].id);assert.equal(next.body.total,r.body.total);
 r=await finance.get('/api/audit-history?area=all');assert.equal(r.status,200);assert.ok(!r.body.items.some(x=>['employee','salary_profile','access_grant','department'].includes(x.type)));
});
test('persistent footer summaries identify the latest modifying and approving actors in a section',async()=>{
 const r=await hr.get('/api/audit-history?area=payroll');assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.summary.modified.actor,'hr');assert.equal(r.body.summary.approved.actor,'root@audit.test');
 assert.ok(r.body.summary.modified.at);assert.equal(r.body.summary.approved.type,'payroll_period');
 assert.ok(r.body.items.some(x=>x.action==='change.approve'));
});
test('approval activity is restricted to the user or an authorized reviewer of its department',async()=>{
 const proposal=await (await import('./hrClient.js')).signIn(app,creds('hr@audit.test'));
 const submitted=await proposal.post('/api/departments').send({name:'Pending audit feed department'});assert.equal(submitted.status,202);
 const r=await finance.get('/api/audit-history?area=approvals');assert.equal(r.status,200);assert.ok(!r.body.items.some(x=>Number(x.recordId)===submitted.body.requestId));
 const own=await hr.get('/api/audit-history?area=approvals');assert.equal(own.status,200);assert.ok(own.body.items.some(x=>Number(x.recordId)===submitted.body.requestId));
 const all=await admin.get('/api/audit-history?area=approvals');assert.equal(all.status,200);assert.ok(all.body.items.some(x=>Number(x.recordId)===submitted.body.requestId));
});


test('footer approval belongs to the latest modification, never an older or unrelated record',async()=>{
 const create=async name=>(await admin.post('/api/departments').send({name})).body.id;
 const recordHR=id=>q("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES((SELECT id FROM users WHERE username='hr@audit.test'),'department.update','department',$1)",[String(id)]);
 const d=await create('Footer first record');await recordHR(d);
 await q("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'change.approve','department',$2)",[root,String(d)]);
 let r=await admin.get('/api/audit-history?area=departments');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.summary.approved.actor,'root@audit.test');
 const other=await create('Footer second record');await recordHR(other);
 r=await admin.get('/api/audit-history?area=departments');assert.equal(r.body.summary.modified.id,String(other));assert.equal(r.body.summary.approved,null);
 await q("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'change.approve','department',$2)",[root,String(other)]);
 await admin.patch(`/api/departments/${other}`).send({name:'Modified after approval'});await recordHR(other);
 r=await admin.get('/api/audit-history?area=departments');assert.equal(r.body.summary.approved,null);
 // PostgreSQL timestamps are shared within a transaction: audit ID breaks ties.
 await db.exec('BEGIN');
 try{
  await recordHR(other);
  await q("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'change.approve','department',$2)",[root,String(other)]);
  await db.exec('COMMIT');
 }catch(e){await db.exec('ROLLBACK');throw e;}
 r=await admin.get('/api/audit-history?area=departments');assert.equal(r.body.summary.approved.actor,'root@audit.test');
});


test('General Admin immediate changes show the same login username and date in both footer records',async()=>{
 const created=await admin.post('/api/departments').send({name:'Immediate Admin change'});assert.equal(created.status,201);
 const changed=await admin.patch(`/api/departments/${created.body.id}`).send({name:'Updated immediately'});assert.equal(changed.status,200);
 const count=(await q('SELECT count(*)::int n FROM audit_logs')).rows[0].n;
 const r=await admin.get('/api/audit-history?area=departments');assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.summary.modified.actor,'root@audit.test');
 assert.deepEqual(r.body.summary.approved,r.body.summary.modified);
 assert.equal((await q('SELECT count(*)::int n FROM audit_logs')).rows[0].n,count,'reading does not fabricate approval events');
});

test('Admin self-authorization uses the grant at the time of modification, not the actor current access',async()=>{
 const modify=()=>q("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'employee.update','employee',$2)",[person.userId,String(person.id)]);
 await modify();
 await q("INSERT INTO access_grants(user_id,access_role,granted_by_user_id,granted_at) VALUES($1,'admin',$2,clock_timestamp()+interval '1 microsecond')",[person.userId,root]);
 let r=await admin.get('/api/audit-history?area=employees');assert.equal(r.body.summary.modified.actor,'plain');assert.equal(r.body.summary.approved,null,'promotion must not authorize an older change');
 await modify();
 await q("UPDATE access_grants SET revoked_at=greatest(clock_timestamp(),(SELECT max(occurred_at)+interval '1 microsecond' FROM audit_logs WHERE actor_user_id=$1)),revoked_by_user_id=$2,revoke_reason='End temporary access' WHERE user_id=$1 AND access_role='admin' AND revoked_at IS NULL",[person.userId,root]);
 r=await admin.get('/api/audit-history?area=employees');assert.equal(r.body.summary.modified.actor,'plain@audit.test');assert.deepEqual(r.body.summary.approved,r.body.summary.modified,'later revocation preserves the original immediate authorization');
});
