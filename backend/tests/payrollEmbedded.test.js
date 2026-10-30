// Real PostgreSQL schema/HTTP checks without an external server. PGlite is single-session;
// multi-connection races remain covered by the external-PostgreSQL suites.
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/natra_embedded_test';process.env.FRONTEND_URL='http://localhost:5173';
const db=new PGlite({extensions:{btree_gist}});
const {pool}=await import('../src/db/pool.js');
// Patch only this isolated Node test worker. No external database connection is opened.
const q=(sql,params)=>db.query(sql,params);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js');
const {signIn}=await import('./hrClient.js');
const {hashPassword}=await import('../src/services/password.js');
const {loginLimits}=await import('../src/routes/auth.js');
const {unlockLimits,tokenLimit}=await import('../src/routes/qr.js');
const {scanDeps,scanLimits}=await import('../src/routes/attendance.js');
const {recordDeps}=await import('../src/routes/attendanceRecords.js');
const {hashQrToken}=await import('../src/services/qrToken.js');
const {loadDashboard}=await import('../src/services/dashboard.js');
const request=(await import('supertest')).default;
const HR={email:'hr@embedded.test',password:'hr-password-123'},EMP={email:'emp@embedded.test',password:'emp-password-123'},OTHER={email:'other@embedded.test',password:'other-password-123'};
let empId,otherId;
const URL='/api/payroll/periods';
async function draft(hr,month='2026-10'){const r=await hr.post(URL).send({month});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function entries(hr,p){const r=await hr.get(`${URL}/${p.id}/entries`);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.items;}
before(async()=>{
 const dir=new globalThis.URL('../../database/migrations/',import.meta.url);
 for(const name of(await fs.readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await fs.readFile(new globalThis.URL(name,dir),'utf8'));
 const shift=(await q("INSERT INTO shifts(name,start_time,end_time,work_days) VALUES('Test','09:00','17:00','{1,2,3,4,5}') RETURNING id")).rows[0].id;
 for(const[c,role,name,code]of[[HR,'hr','HR Admin'],[EMP,'employee','Own Employee','E-1'],[OTHER,'employee','Other Employee','E-2']]){
  const u=(await q('INSERT INTO users(email,full_name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[c.email,name,await hashPassword(c.password),role])).rows[0].id;
  if(role==='hr')await q("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[u]);
  if(code){const id=Number((await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id) VALUES($1,$2,'2026-01-05',$3) RETURNING id",[code,u,shift])).rows[0].id);if(code==='E-1')empId=id;else otherId=id;}
 }
});
beforeEach(async()=>{
 loginLimits.ip.clear();loginLimits.pair.clear();unlockLimits.session.clear();unlockLimits.user.clear();tokenLimit.clear();scanLimits.user.clear();
 await db.exec('TRUNCATE audit_logs,attendance_tokens,sessions,payroll_periods,deduction_items,salary_profiles,income_tax_brackets,other_taxes,attendance_records,leave_requests,holidays RESTART IDENTITY CASCADE');
 await q("UPDATE payroll_settings SET employee_pension_rate=5,company_pension_rate=10,tax_base='basic',pension_base='basic',absence_deduction_enabled=false,unpaid_leave_deduction_enabled=false");
 await q('INSERT INTO income_tax_brackets(from_minor,rate,fixed_deduction_minor) VALUES(0,15,15000)');
 await q('INSERT INTO salary_profiles(employee_id,basic_minor,allowance_minor) VALUES($1,250000,10000),($2,100000,0)',[empId,otherId]);
});
after(async()=>{await pool.end();await db.close();});

test('embedded PostgreSQL #16: approved/paid HTTP recalculation and direct SQL writes are blocked',async()=>{
 const hr=await signIn(app,HR);
 await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor) VALUES($1,'advance','Locked advance',1000)",[empId]);
 const p=await draft(hr),rows=await entries(hr,p),e=rows[0];
 // Draft item writes are allowed; approved items must reject updates, deletes and inserts.
 await q("INSERT INTO payroll_entry_items(entry_id,kind,label,amount_minor) VALUES($1,'other','Zero',0)",[e.id]);
 await q("DELETE FROM payroll_entry_items WHERE entry_id=$1 AND label='Zero'",[e.id]);
 assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status,200);
 assert.equal((await hr.patch(`${URL}/${p.id}/entries/${e.id}`).send({basicMinor:1})).status,409);
 for(const[sql,params]of[
  ['UPDATE payroll_entries SET basic_minor=basic_minor WHERE id=$1',[e.id]],['DELETE FROM payroll_entries WHERE id=$1',[e.id]],
  ['UPDATE payroll_entry_items SET amount_minor=1 WHERE entry_id=$1',[e.id]],
  ['DELETE FROM payroll_entry_items WHERE entry_id=$1',[e.id]],
  ["INSERT INTO payroll_entry_items(entry_id,kind,label,amount_minor) VALUES($1,'loan','Late',1)",[e.id]],
  ["UPDATE payroll_periods SET config_snapshot='{}' WHERE id=$1",[p.id]],['DELETE FROM payroll_periods WHERE id=$1',[p.id]],
  ["UPDATE payroll_periods SET status='draft',approved_at=NULL WHERE id=$1",[p.id]],
 ])await assert.rejects(q(sql,params),/locked|deleted/);
 assert.equal((await hr.post(`${URL}/${p.id}/pay`).send({paidOn:'2026-10-31'})).status,200);
 assert.equal((await hr.patch(`${URL}/${p.id}/entries/${e.id}`).send({allowanceMinor:0})).status,409);
 await assert.rejects(q("UPDATE payroll_periods SET paid_on='2026-11-01' WHERE id=$1",[p.id]),/locked/);
 assert.deepEqual(await entries(hr,p),rows);
});

test('embedded PostgreSQL #17: snapshot, entries, payslip and CSV history survive configuration/source edits',async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP);
 await q("INSERT INTO other_taxes(name,rate,base) VALUES('Original tax',1,'gross')");
 await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor,recurring) VALUES($1,'loan','Original loan',5000,true)",[empId]);
 const p=await draft(hr),rows=await entries(hr,p),e=rows.find(r=>r.employeeId===empId);
 assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status,200);
 const period=(await hr.get(`${URL}/${p.id}`)).body,detail=(await hr.get(`${URL}/${p.id}/entries/${e.id}`)).body;
 const slip=(await emp.get(`/api/payslips/${e.id}`)).body,csv=(await hr.get(`${URL}/${p.id}/export.csv`)).text;
 assert.equal(period.configSnapshot.entries.length,2);assert.equal(period.configSnapshot.settings.currencyCode,'ETB');
 await q('UPDATE income_tax_brackets SET rate=20');await q('UPDATE payroll_settings SET employee_pension_rate=8');
 await q('UPDATE salary_profiles SET basic_minor=999,allowance_taxable=false,pension_applies=false');
 await q("UPDATE other_taxes SET name='Changed tax',rate=3");await q("UPDATE deduction_items SET name='Changed loan',amount_minor=9000");
 assert.deepEqual((await hr.get(`${URL}/${p.id}`)).body,period);assert.deepEqual(await entries(hr,p),rows);
 assert.deepEqual((await hr.get(`${URL}/${p.id}/entries/${e.id}`)).body,detail);
 assert.deepEqual((await emp.get(`/api/payslips/${e.id}`)).body,slip);assert.equal((await hr.get(`${URL}/${p.id}/export.csv`)).text,csv);
 const next=await draft(hr,'2026-11');assert.notEqual((await entries(hr,next))[0].netMinor,e.netMinor);
});

test('embedded PostgreSQL #1: ownership, draft hiding, guessed IDs, HR endpoints and tablet lock',async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP),other=await signIn(app,OTHER),p=await draft(hr),rows=await entries(hr,p);
 const own=rows.find(r=>r.employeeId===empId),theirs=rows.find(r=>r.employeeId===otherId);
 assert.equal((await request(app).get('/api/payslips')).status,401);assert.equal((await emp.get(`/api/payslips/${own.id}`)).status,404);
 assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status,200);
 assert.deepEqual((await emp.get(`/api/payslips?employeeId=${otherId}&userId=999`)).body.items.map(i=>i.id),[own.id]);
 assert.equal((await emp.get(`/api/payslips/${theirs.id}`)).status,404);assert.equal((await other.get(`/api/payslips/${own.id}`)).status,404);
 const slip=(await emp.get(`/api/payslips/${own.id}`)).body;assert.ok(!JSON.stringify(slip).includes('Other Employee'));assert.ok(!JSON.stringify(slip).includes('configSnapshot'));
 for(const path of[URL,`${URL}/${p.id}/entries`,`${URL}/${p.id}/entries/${theirs.id}`,`${URL}/${p.id}/export.csv`,'/api/dashboard',`/api/salary-profiles/${otherId}`])assert.equal((await emp.get(path)).status,403,path);
 assert.equal((await emp.patch(`${URL}/${p.id}/entries/${theirs.id}`).send({basicMinor:1})).status,403);
 assert.equal((await hr.get('/api/payslips')).status,403);await hr.post('/api/qr/lock').send({});assert.equal((await hr.get(`${URL}/${p.id}/export.csv`)).status,423);
});

test('embedded PostgreSQL: stale approval, one-time consumption and audit-failure rollback',async()=>{
 const hr=await signIn(app,HR);await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor) VALUES($1,'advance','Once',2000)",[empId]);
 const p=await draft(hr),e=(await entries(hr,p)).find(r=>r.employeeId===empId),path=`${URL}/${p.id}/entries/${e.id}`;assert.equal(e.otherDeductionsMinor,2000);
 await q('UPDATE income_tax_brackets SET rate=20');assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).body.error.code,'stale_payroll');
 for(const row of await entries(hr,p))assert.equal((await hr.patch(`${URL}/${p.id}/entries/${row.id}`).send({basicMinor:row.basicMinor})).status,200);
 assert.equal((await hr.patch(path).send({basicMinor:e.basicMinor})).body.otherDeductionsMinor,2000);
 await db.exec("CREATE FUNCTION fail_approval_test() RETURNS trigger AS $$ BEGIN IF NEW.action='payroll.period.approve' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_approval_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_approval_test()");
 try{assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status,500);const period=(await hr.get(`${URL}/${p.id}`)).body;assert.equal(period.status,'draft');assert.equal(period.configSnapshot,null);}
 finally{await db.exec('DROP TRIGGER fail_approval_test ON audit_logs; DROP FUNCTION fail_approval_test()');}
 assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status,200);
 const next=await draft(hr,'2026-11');assert.equal((await entries(hr,next)).find(r=>r.employeeId===empId).otherDeductionsMinor,0);
});

test('embedded PostgreSQL: attendance replaces once; dashboard and month-filter SQL execute',async()=>{
 const hr=await signIn(app,HR);assert.equal((await hr.patch('/api/payroll-settings/attendance-deductions').send({absenceDeductionEnabled:true,unpaidLeaveDeductionEnabled:true})).status,200);
 await q('UPDATE salary_profiles SET basic_minor=220000,allowance_minor=0');
 const p=await draft(hr,'2026-01'),e=(await entries(hr,p))[0];assert.equal(e.otherDeductionsMinor,200000);
 for(let i=0;i<2;i++)assert.equal((await hr.patch(`${URL}/${p.id}/entries/${e.id}`).send({basicMinor:220000})).body.otherDeductionsMinor,200000);
 assert.equal((await q("SELECT count(*)::int n FROM payroll_entry_items WHERE entry_id=$1 AND kind='absence'",[e.id])).rows[0].n,1);
 const dash=await loadDashboard({query:q},{now:'2026-01-05T18:00:00Z'});assert.equal(dash.stats.absentToday,2);assert.equal(dash.payroll.employeeCount,2);
 assert.equal((await hr.get(`${URL}?month=2026-01`)).body.total,1);assert.equal((await hr.get(`${URL}?month=2026-02`)).body.total,0);
});

test('embedded PostgreSQL: failed generation rolls back partial entries/consumption and duplicate months conflict',async()=>{
 const hr=await signIn(app,HR);
 await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor) VALUES($1,'advance','Once',2000)",[empId]);
 await db.exec(`CREATE FUNCTION fail_generation_test() RETURNS trigger AS $$ BEGIN IF NEW.employee_id=${otherId} THEN RAISE EXCEPTION 'forced entry failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_generation_test BEFORE INSERT ON payroll_entries FOR EACH ROW EXECUTE FUNCTION fail_generation_test()`);
 try{
  assert.equal((await hr.post(URL).send({month:'2026-10'})).status,500);
  assert.equal((await q('SELECT count(*)::int n FROM payroll_periods')).rows[0].n,0);
  assert.equal((await q('SELECT count(*)::int n FROM payroll_entries')).rows[0].n,0);
  assert.equal((await q('SELECT applied_period_id FROM deduction_items')).rows[0].applied_period_id,null);
  assert.equal((await q("SELECT count(*)::int n FROM audit_logs WHERE action='payroll.period.generate'")).rows[0].n,0);
 }finally{await db.exec('DROP TRIGGER fail_generation_test ON payroll_entries; DROP FUNCTION fail_generation_test()');}
 const p=await draft(hr),saved=await entries(hr,p);
 assert.equal((await hr.post(URL).send({month:'2026-10'})).status,409);
 assert.deepEqual(await entries(hr,p),saved);
 assert.equal((await q("SELECT count(*)::int n FROM audit_logs WHERE action='payroll.period.generate'")).rows[0].n,1);
});

test('embedded PostgreSQL #2/#3: locked HR cannot bypass admin guards with methods or URL changes',async()=>{
 const hr=await signIn(app,HR);assert.equal((await hr.post('/api/qr/lock').send({})).status,200);
 for(const[method,path]of[
  ['get','/api/employees'],['post','/api/employees'],['get','/api/dashboard'],['get',URL],['post',URL],
  ['post',`${URL}/1/approve`],['post',`${URL}/1/pay`],['patch',`${URL}/1/entries/1`],['get',`${URL}/1/export.csv`],
  ['get',`/api/salary-profiles/${empId}`],['put',`/api/salary-profiles/${empId}`],['patch','/api/payroll-settings/attendance-deductions'],
  ['get','/api/employees?locked=false'],['get','/api//employees'],['get','/api/%65mployees'],['get','/API/employees'],
 ])assert.equal((await hr[method](path)).status,423,`${method} ${path}`);
 assert.equal((await hr.get('/api/auth/me')).body.locked,true);assert.equal((await hr.post('/api/qr/tokens').send({})).status,201);
});
test('embedded PostgreSQL #4/#5: refresh retains lock; only valid password reauthentication unlocks',async()=>{
 const hr=await signIn(app,HR);await hr.post('/api/qr/lock').send({});
 for(let i=0;i<2;i++){assert.equal((await hr.get('/api/auth/me')).body.locked,true);assert.equal((await hr.get('/api/employees')).status,423);}
 assert.equal((await hr.post('/api/qr/unlock').send({})).status,400);
 assert.equal((await hr.post('/api/qr/unlock').send({password:'wrong-password'})).status,403);
 assert.equal((await hr.get('/api/auth/me')).body.locked,true);
 assert.equal((await hr.post('/api/qr/unlock').send({password:HR.password})).status,200);
 assert.equal((await hr.get('/api/auth/me')).body.locked,false);assert.equal((await hr.get('/api/employees')).status,200);
});
test('embedded PostgreSQL #6: locking and unlocking one HR device never changes another session',async()=>{
 const a=await signIn(app,HR),b=await signIn(app,HR);await a.post('/api/qr/lock').send({});assert.equal((await b.get('/api/auth/me')).body.locked,false);
 await b.post('/api/qr/lock').send({});await a.post('/api/qr/unlock').send({password:HR.password});
 assert.equal((await a.get('/api/auth/me')).body.locked,false);assert.equal((await b.get('/api/auth/me')).body.locked,true);
 assert.equal((await a.get('/api/employees')).status,200);assert.equal((await b.get('/api/employees')).status,423);
});
const scanPhoto=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(2000)]).toString('base64');
test('embedded PostgreSQL #7/#8/#10: expired/replayed tokens rejected and first valid scan checks in',async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP),original=scanDeps.photos;let uploads=0;
 scanDeps.photos={upload:async()=>{uploads++;return 'natra/selfies/2026/abcdefghijklmnopqrstuvwx';},delete:async()=> 'ok'};
 try{
  const expired=(await hr.post('/api/qr/tokens').send({})).body.token;
  await q("UPDATE attendance_tokens SET created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=$1",[hashQrToken(expired)]);
  const bad=await emp.post('/api/attendance/scan').send({token:expired,photo:scanPhoto});assert.equal(bad.status,410,JSON.stringify(bad.body));assert.equal(uploads,0);
  const live=(await hr.post('/api/qr/tokens').send({})).body.token;
  const first=await emp.post('/api/attendance/scan').send({token:live,photo:scanPhoto});assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.action,'check_in');assert.ok(first.body.checkInAt);assert.equal(first.body.checkOutAt,null);
  const replay=await emp.post('/api/attendance/scan').send({token:live,photo:scanPhoto});assert.equal(replay.status,409);assert.equal(replay.body.error.code,'token_already_scanned');assert.equal(uploads,1);
  assert.equal((await q('SELECT count(*)::int n FROM attendance_records')).rows[0].n,1);
  await assert.rejects(q("INSERT INTO attendance_records(employee_id,work_date,status,check_out_at) VALUES($1,'2026-01-06','incomplete',now())",[otherId]),/attendance_out_needs_in/);
 }finally{scanDeps.photos=original;}
});
test('embedded PostgreSQL #11: photo links are HR-only, no-store and audited; employee history hides photo IDs',async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP),photoId='natra/selfies/2026/abcdefghijklmnopqrstuvwx';
 const id=(await q("INSERT INTO attendance_records(employee_id,work_date,status,check_in_at,check_in_photo_id) VALUES($1,'2026-01-06','present','2026-01-06T06:00:00Z',$2) RETURNING id",[empId,photoId])).rows[0].id;
 const path=`/api/attendance-records/${id}/photos/check_in`;
 assert.equal((await request(app).get(path)).status,401);assert.equal((await emp.get(path)).status,403);
 const original=recordDeps.photos;
 recordDeps.photos={signedUrl:async value=>{assert.equal(value,photoId);return {url:'https://example.test/authenticated/signed-photo',expiresAt:'2099-01-01T00:00:00Z'};}};
 try{const r=await hr.get(path);assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.ok(r.body.expiresAt);
  const history=await emp.get('/api/attendance/mine');assert.equal(history.status,200);assert.ok(!JSON.stringify(history.body).includes(photoId));
  const audit=(await q("SELECT details FROM audit_logs WHERE action='attendance.photo_view'")).rows;assert.equal(audit.length,1);assert.ok(!JSON.stringify(audit).includes(photoId));
 }finally{recordDeps.photos=original;}
});

test('company costs: HR-only paid monthly totals match all saved entries and preserve historical amounts', async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP);
 assert.equal((await request(app).get('/api/payroll-costs')).status,401);
 assert.equal((await emp.get('/api/payroll-costs')).status,403);
 const first=await draft(hr,'2026-09');
 assert.equal((await hr.get('/api/payroll-costs')).body.total,0);
 assert.equal((await hr.post(`${URL}/${first.id}/approve`).send({})).status,200);
 assert.equal((await hr.get('/api/payroll-costs')).body.total,0);
 assert.equal((await hr.post(`${URL}/${first.id}/pay`).send({paidOn:'2026-10-05'})).status,200);
 const saved=await entries(hr,first),sum=key=>saved.reduce((n,e)=>n+e[key],0);
 let r=await hr.get('/api/payroll-costs');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.total,1);
 assert.equal(r.headers['cache-control'],'no-store');
 const cost=r.body.items[0];assert.equal(cost.month,'2026-09');assert.equal(cost.paidOn,'2026-10-05');assert.equal(cost.employeeCount,2);assert.equal(cost.currency,'ETB');
 assert.equal(cost.salaryPaidMinor,sum('netMinor'));assert.equal(cost.grossMinor,sum('grossMinor'));assert.equal(cost.companyPensionMinor,sum('employerPensionMinor'));assert.equal(cost.employerCostMinor,sum('employerCostMinor'));
 await q('UPDATE salary_profiles SET basic_minor=999999 WHERE employee_id=$1',[empId]);
 await q('UPDATE payroll_settings SET company_pension_rate=50');
 assert.deepEqual((await hr.get('/api/payroll-costs')).body.items[0],cost);
 const second=await draft(hr,'2026-10');
 assert.equal((await hr.post(`${URL}/${second.id}/approve`).send({})).status,200);
 assert.equal((await hr.post(`${URL}/${second.id}/pay`).send({paidOn:'2026-10-28'})).status,200);
 r=await hr.get('/api/payroll-costs?pageSize=1&page=1');assert.equal(r.body.total,2);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].month,'2026-10');
 r=await hr.get('/api/payroll-costs?pageSize=1&page=2');assert.equal(r.body.items[0].month,'2026-09');
 const detail1=await hr.get(`${URL}/${first.id}/entries?pageSize=1&page=1`),detail2=await hr.get(`${URL}/${first.id}/entries?pageSize=1&page=2`);
 assert.equal(detail1.body.total,2);assert.notEqual(detail1.body.items[0].employeeId,detail2.body.items[0].employeeId);
 assert.equal((await hr.get('/api/payroll-costs?page=0')).status,400);
});

test('regeneration refreshes draft inputs and manual edits while applying one-time deductions exactly once',async()=>{
 const hr=await signIn(app,HR);
 const first=(await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor) VALUES($1,'advance','First',1000) RETURNING id",[empId])).rows[0].id;
 await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor,recurring) VALUES($1,'other','Recurring',500,true)",[empId]);
 const p=await draft(hr,'2026-08');const original=(await entries(hr,p)).find(e=>e.employeeId===empId);
 assert.equal(original.otherDeductionsMinor,1500);
 await hr.patch(`${URL}/${p.id}/entries/${original.id}`).send({basicMinor:777777});
 const elsewhere=(await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor) VALUES($1,'loan','Elsewhere',2000) RETURNING id",[empId])).rows[0].id;
 const otherPeriod=await draft(hr,'2026-09');
 const added=(await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor) VALUES($1,'penalty','New',3000) RETURNING id",[empId])).rows[0].id;
 await q('UPDATE salary_profiles SET basic_minor=300000,allowance_taxable=true WHERE employee_id=$1',[empId]);
 await q("UPDATE payroll_settings SET tax_base='basic_plus_taxable_allowance'");
 for(let i=0;i<2;i++){
  const r=await hr.post(`${URL}/${p.id}/regenerate`).send({});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.id,p.id);assert.equal(r.body.month,'2026-08');assert.equal(r.body.status,'draft');
  const list=await entries(hr,p);assert.equal(list.length,2);const e=list.find(e=>e.employeeId===empId);
  assert.equal(e.basicMinor,300000);assert.equal(e.taxableIncomeMinor,310000);assert.equal(e.otherDeductionsMinor,4500);
  const {rows}=await q('SELECT id,applied_period_id FROM deduction_items WHERE id=ANY($1::bigint[]) ORDER BY id',[[first,elsewhere,added]]);
  assert.deepEqual(rows.map(r=>Number(r.applied_period_id)),[p.id,otherPeriod.id,p.id]);
 }
 assert.equal((await q("SELECT count(*)::int AS n FROM audit_logs WHERE action='payroll.period.regenerate'")).rows[0].n,2);
 assert.equal((await hr.get(`${URL}/${p.id}/entries/${original.id}`)).status,404);
});
test('regeneration uses current active employees and current attendance without changing approved or paid payrolls',async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP),p=await draft(hr,'2026-01');
 const original=await entries(hr,p);
 await q("UPDATE employees SET status='inactive' WHERE id=$1",[otherId]);
 try {
  assert.equal((await hr.post(`${URL}/${p.id}/regenerate`).send({})).status,200);
  assert.deepEqual((await entries(hr,p)).map(e=>e.employeeId),[empId]);
 }finally{await q("UPDATE employees SET status='active' WHERE id=$1",[otherId]);}
 await q("UPDATE payroll_settings SET absence_deduction_enabled=true");
 const r=await hr.post(`${URL}/${p.id}/regenerate`).send({});assert.equal(r.status,200,JSON.stringify(r.body));
 const refreshed=await entries(hr,p);assert.equal(refreshed.length,2);assert.ok(refreshed.find(e=>e.employeeId===empId).otherDeductionsMinor>original.find(e=>e.employeeId===empId).otherDeductionsMinor);
 assert.equal((await request(app).post(`${URL}/${p.id}/regenerate`).send({})).status,401);
 assert.equal((await emp.post(`${URL}/${p.id}/regenerate`).send({})).status,403);
 assert.equal((await hr.post(`${URL}/999999/regenerate`).send({})).status,404);
 assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status,200);
 const approved=await entries(hr,p);
 assert.equal((await hr.post(`${URL}/${p.id}/regenerate`).send({})).status,409);assert.deepEqual(await entries(hr,p),approved);
 assert.equal((await hr.post(`${URL}/${p.id}/pay`).send({paidOn:'2026-01-31'})).status,200);
 assert.equal((await hr.post(`${URL}/${p.id}/regenerate`).send({})).status,409);assert.deepEqual(await entries(hr,p),approved);
});
test('failed regeneration rolls back original draft entries and deduction allocations together',async()=>{
 const hr=await signIn(app,HR);
 const once=(await q("INSERT INTO deduction_items(employee_id,kind,name,amount_minor) VALUES($1,'advance','Once',1000) RETURNING id",[empId])).rows[0].id;
 const p=await draft(hr),before=await entries(hr,p);
 await db.exec(`CREATE FUNCTION fail_regeneration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.action='payroll.period.regenerate' THEN RAISE EXCEPTION 'injected regeneration failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER test_regeneration_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_regeneration_audit();`);
 try{assert.equal((await hr.post(`${URL}/${p.id}/regenerate`).send({})).status,500);}
 finally{await db.exec('DROP TRIGGER test_regeneration_failure ON audit_logs;DROP FUNCTION fail_regeneration_audit()');}
 assert.deepEqual(await entries(hr,p),before);
 assert.equal(Number((await q('SELECT applied_period_id FROM deduction_items WHERE id=$1',[once])).rows[0].applied_period_id),p.id);
 await q('DELETE FROM salary_profiles WHERE employee_id=$1',[empId]);
 assert.equal((await hr.post(`${URL}/${p.id}/regenerate`).send({})).status,422);assert.deepEqual(await entries(hr,p),before);
 assert.equal((await q("SELECT count(*)::int AS n FROM audit_logs WHERE action='payroll.period.regenerate'")).rows[0].n,0);
});
