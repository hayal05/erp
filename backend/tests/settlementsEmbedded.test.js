import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/settlements_test';
const db=new PGlite({extensions:{btree_gist}});
const {pool}=await import('../src/db/pool.js');const q=(sql,p)=>db.query(sql,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js');const {signIn}=await import('./hrClient.js');const {hashPassword}=await import('../src/services/password.js');const {companyDate}=await import('../src/services/attendance.js');
const request=(await import('supertest')).default;
let hr,employee,hrId;
const credentials={email:'hr@settlements.test',password:'password-123'};
const payment=(kind='income_tax',amountMinor=10000)=>({kind,amountMinor,paymentDate:companyDate(),reference:'BANK-REF-123',notes:'Remitted',requestId:randomUUID()});
async function period(month='2026-10',state='paid'){
 let r=await hr.post('/api/payroll/periods').send({month});assert.equal(r.status,201,JSON.stringify(r.body));const p=r.body;
 if(state==='draft')return p;
 r=await hr.post(`/api/payroll/periods/${p.id}/approve`).send({});assert.equal(r.status,200,JSON.stringify(r.body));if(state==='approved')return p;
 r=await hr.post(`/api/payroll/periods/${p.id}/pay`).send({paidOn:'2026-10-01'});assert.equal(r.status,200,JSON.stringify(r.body));return p;
}
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 for(const name of(await fs.readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(name,dir),'utf8'));
 const shift=(await q("INSERT INTO shifts(name,start_time,end_time,work_days) VALUES('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id")).rows[0].id;
 for(const[email,role,code,basic]of[['hr@settlements.test','hr',null,0],['employee@settlements.test','employee','E1',250000],['other@settlements.test','employee','E2',100000]]){
  const u=(await q('INSERT INTO users(email,full_name,password_hash,role) VALUES($1,$1,$2,$3) RETURNING id',[email,await hashPassword('password-123'),role])).rows[0].id;
  if(role==='hr'){hrId=u;await q("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[u]);}
  if(code){const e=(await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id) VALUES($1,$2,'2025-01-01',$3) RETURNING id",[code,u,shift])).rows[0].id;
   await q('INSERT INTO salary_profiles(employee_id,basic_minor,allowance_minor) VALUES($1,$2,10000)',[e,basic]);}
 }
 hr=await signIn(app,credentials);employee=await signIn(app,{email:'employee@settlements.test',password:'password-123'});
});
beforeEach(async()=>{
 await db.exec('TRUNCATE payroll_periods,audit_logs RESTART IDENTITY CASCADE');
 await q("UPDATE payroll_settings SET employee_pension_rate=5,company_pension_rate=10,tax_base='basic',pension_base='basic',absence_deduction_enabled=false,unpaid_leave_deduction_enabled=false,currency_code='ETB'");
 await db.exec('TRUNCATE income_tax_brackets');await q('INSERT INTO income_tax_brackets(from_minor,rate,fixed_deduction_minor) VALUES(0,15,15000)');
});
after(async()=>db.close());
test('HR-only routes, CSRF and tablet lock protect settlement data and payments',async()=>{
 const p=await period();
 assert.equal((await request(app).get('/api/settlements')).status,401);
 for(const path of ['/api/settlements',`/api/settlements/${p.id}`,`/api/settlements/${p.id}/payments?kind=income_tax`])assert.equal((await employee.get(path)).status,403);
 assert.equal((await employee.post(`/api/settlements/${p.id}/payments`).send(payment())).status,403);
 const raw=request.agent(app);await raw.post('/api/auth/login').send(credentials);
 assert.equal((await raw.post(`/api/settlements/${p.id}/payments`).send(payment())).status,403);
 const locked=await signIn(app,credentials);assert.equal((await locked.post('/api/qr/lock').send({})).status,200);
 assert.equal((await locked.get('/api/settlements')).status,423);assert.equal((await locked.post(`/api/settlements/${p.id}/payments`).send(payment())).status,423);
});
test('only paid payrolls create tax and combined employee/company pension payables',async()=>{
 const draft=await period('2026-08','draft'),approved=await period('2026-09','approved');
 assert.equal((await hr.get('/api/settlements')).body.total,0);
 assert.equal((await hr.post(`/api/settlements/${draft.id}/payments`).send(payment())).status,409);
 assert.equal((await hr.get(`/api/settlements/${approved.id}`)).status,409);
 const p=await period();const r=await hr.get('/api/settlements');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.total,1);assert.equal(r.headers['cache-control'],'no-store');
 const b=r.body.items[0];assert.equal(b.incomeTaxMinor,22500);assert.equal(b.employeePensionMinor,17500);assert.equal(b.companyPensionMinor,35000);assert.equal(b.pensionMinor,52500);assert.equal(b.pensionBalanceMinor,52500);assert.equal(b.employeeCount,2);
 assert.equal((await hr.get(`/api/settlements/${p.id}`)).body.today,companyDate());
 const detail=await hr.get(`/api/payroll/periods/${p.id}/entries?pageSize=1&page=2`);assert.equal(detail.body.total,2);assert.equal(detail.body.items.length,1);
});
test('partial/full payments reduce only their own balance, retry idempotently and retain audited history',async()=>{
 const p=await period(),url=`/api/settlements/${p.id}/payments`,body=payment();
 let r=await hr.post(url).send(body);assert.equal(r.status,201,JSON.stringify(r.body));const receipt=r.body.id;
 r=await hr.post(url).send(body);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.id,receipt);assert.equal(r.body.reused,true);
 assert.equal((await hr.post(url).send({...body,amountMinor:1})).status,409);
 let balance=(await hr.get(`/api/settlements/${p.id}`)).body;assert.equal(balance.incomeTaxSettledMinor,10000);assert.equal(balance.incomeTaxBalanceMinor,12500);assert.equal(balance.pensionBalanceMinor,52500);
 assert.equal((await hr.post(url).send(payment('income_tax',12500))).status,201);
 assert.equal((await hr.post(url).send(payment('pension',52500))).status,201);
 assert.equal((await hr.get('/api/settlements')).body.total,0);assert.equal((await hr.get('/api/settlements?view=all')).body.total,1);
 assert.equal((await hr.get('/api/settlements')).body.summary[0].incomeTaxBalanceMinor,0);
 r=await hr.get(url+'?kind=income_tax&pageSize=1&page=1');assert.equal(r.body.total,2);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].reference,body.reference);assert.equal(r.body.items[0].recordedBy,credentials.email);
 assert.equal((await hr.get(url+'?kind=income_tax&pageSize=1&page=2')).body.items[0].id,receipt);
 const logs=await q("SELECT * FROM audit_logs WHERE action='settlement.record'");assert.equal(logs.rows.length,3);
});
test('overpayments and invalid inputs leave balances unchanged; ledger is immutable and enforces remaining amounts',async()=>{
 const p=await period(),url=`/api/settlements/${p.id}/payments`;
 assert.equal((await hr.post(url).send(payment('income_tax',22501))).status,409);
 for(const amount of [0,-1,0.5,Number.MAX_SAFE_INTEGER])assert.equal((await hr.post(url).send(payment('income_tax',amount))).status,400);
 const tomorrow=new Date(companyDate()+'T00:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
 assert.equal((await hr.post(url).send({...payment(),paymentDate:tomorrow.toISOString().slice(0,10)})).status,422);
 assert.equal((await hr.post(url).send({...payment(),reference:' '})).status,400);
 assert.equal((await hr.post(url).send({...payment(),kind:'other'})).status,400);
 assert.equal((await hr.post(url).send({...payment(),paymentDate:'not-a-date'})).status,400);
 assert.equal((await hr.post('/api/settlements/99999/payments').send(payment())).status,404);
 assert.equal((await hr.get('/api/settlements?page=0')).status,400);
 assert.equal((await hr.get(url+'?kind=other')).status,400);
 assert.equal((await hr.post(url).send(payment('income_tax',22500))).status,201);
 await assert.rejects(q("INSERT INTO payroll_settlements(period_id,kind,amount_minor,payment_date,reference,request_id,recorded_by_user_id) VALUES($1,'income_tax',1,'2026-10-01','EXCESS',$2,$3)",[p.id,randomUUID(),hrId]),/exceeds.*balance/i);
 await assert.rejects(q('UPDATE payroll_settlements SET amount_minor=1 WHERE period_id=$1',[p.id]),/cannot be edited or deleted/i);
 await assert.rejects(q('DELETE FROM payroll_settlements WHERE period_id=$1',[p.id]),/cannot be edited or deleted/i);
 assert.equal((await hr.get(`/api/settlements/${p.id}`)).body.incomeTaxBalanceMinor,0);
});
test('months paginate and outstanding currency summaries use saved payroll snapshots',async()=>{
 const first=await period('2026-09');await q("UPDATE payroll_settings SET currency_code='USD'");const second=await period('2026-10');
 let r=await hr.get('/api/settlements?pageSize=1&page=1');assert.equal(r.body.total,2);assert.equal(r.body.items[0].id,second.id);assert.equal(r.body.summary.length,2);
 r=await hr.get('/api/settlements?pageSize=1&page=2');assert.equal(r.body.items[0].id,first.id);assert.equal(r.body.items[0].currency,'ETB');
 await q('UPDATE payroll_settings SET employee_pension_rate=0,company_pension_rate=0');
 assert.equal((await hr.get(`/api/settlements/${first.id}`)).body.pensionBalanceMinor,52500);
});
