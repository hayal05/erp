// Embedded PostgreSQL validates schema/transactions and HTTP flow. This is not a
// multi-connection load test; native race coverage lives in attendanceScan.test.js.
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/shared_qr_test';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');
const q=(s,p)=>db.query(s,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js');
const {signIn}=await import('./hrClient.js');
const {hashPassword}=await import('../src/services/password.js');
const {applyScan}=await import('../src/services/attendance.js');
const {issueQrToken,hashQrToken}=await import('../src/services/qrToken.js');
const {scanDeps,scanLimits}=await import('../src/routes/attendance.js');
const {tokenLimit}=await import('../src/routes/qr.js');
const photo='natra/selfies/2026/abcdefghijklmnopqrstuvwx';
const jpeg=Buffer.from([255,216,255,224,0,0]).toString('base64');
const password='password-123';let adminId,employees=[],uploaded,deleted;
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 const hash=await hashPassword(password);
 adminId=(await q("INSERT INTO users(username,full_name,password_hash,role) VALUES('admin','Admin',$1,'hr') RETURNING id",[hash])).rows[0].id;
 await q("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[adminId]);
 const spare=(await q("INSERT INTO users(username,full_name,password_hash,role) VALUES('spare.admin','Spare',$1,'employee') RETURNING id",[hash])).rows[0].id;
 await q("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[spare]);
 const shift=(await q("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','09:00','17:00') RETURNING id")).rows[0].id;
 await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id) VALUES('SPARE',$1,'2026-01-01',$2)",[spare,shift]);
 for(let i=0;i<50;i++){
  const userId=(await q("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$1,$2,'employee') RETURNING id",['employee'+i,hash])).rows[0].id;
  const id=(await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id) VALUES($1,$2,'2026-01-01',$3) RETURNING id",['E'+i,userId,shift])).rows[0].id;
  employees.push({id,userId});
 }
});
beforeEach(async()=>{
 await db.exec('TRUNCATE attendance_tokens,attendance_records,sessions,audit_logs RESTART IDENTITY CASCADE');
 await q("INSERT INTO sessions(id,user_id,csrf_token,expires_at) VALUES('issuer',$1,'csrf',now()+interval '1 hour')",[adminId]);
 uploaded=0;deleted=[];scanLimits.user.clear();tokenLimit.clear();
 scanDeps.photos={upload:async()=>{uploaded++;return photo;},delete:async id=>{deleted.push(id);}};
});
after(async()=>db.close());
const issue=async()=> (await issueQrToken({query:q},{sessionId:'issuer',userId:adminId})).token;
const scan=(e,token,extra={})=>applyScan({employeeId:e.id,userId:e.userId,token,workDate:'2026-10-30',photoId:photo,...extra});
const count=async table=>(await q(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;

test('one shared QR records 50 different employees without consuming the global token',async()=>{
 const token=await issue();
 for(const e of employees)assert.equal((await scan(e,token)).action,'check_in');
 assert.equal(await count('attendance_records'),50);
 assert.equal(await count('attendance_token_scans'),50);
 assert.equal((await q('SELECT used_at FROM attendance_tokens')).rows[0].used_at,null);
 assert.equal((await q("SELECT count(*)::int n FROM audit_logs WHERE action='attendance.check_in'")).rows[0].n,50);
 await assert.rejects(scan(employees[0],token),e=>e.code==='token_already_scanned');
 assert.equal((await q('SELECT check_out_at FROM attendance_records WHERE employee_id=$1',[employees[0].id])).rows[0].check_out_at,null);
 const next=await issue();
 assert.equal((await scan(employees[0],next)).action,'check_out');
 await assert.rejects(scan(employees[1],token),e=>e.code==='token_expired');
});

test('HTTP replay is refused before another upload; a second employee can use the same QR',async()=>{
 const token=await issue(),a=await signIn(app,{username:'employee0',password}),b=await signIn(app,{username:'employee1',password});
 const submit=client=>client.post('/api/attendance/scan').send({token,photo:jpeg});
 assert.equal((await submit(a)).status,201);
 const replay=await submit(a);assert.equal(replay.status,409);assert.equal(replay.body.error.code,'token_already_scanned');assert.equal(uploaded,1);
 assert.equal((await submit(b)).status,201);assert.equal(uploaded,2);assert.deepEqual(deleted,[]);
 assert.equal((await q('SELECT count(*)::int n FROM attendance_records WHERE check_out_at IS NOT NULL')).rows[0].n,0);
 const admin=await signIn(app,{username:'admin',password});
 assert.equal((await admin.get('/api/qr/status')).body.active,true);
});

test('failed attendance write rolls back the receipt, allowing a retry with the same QR',async()=>{
 const token=await issue();
 await assert.rejects(scan(employees[0],token,{checkIn:{status:'present',lateMinutes:5}}),/attendance_late_only_when_late/);
 assert.equal(await count('attendance_token_scans'),0);assert.equal(await count('attendance_records'),0);assert.equal(await count('audit_logs'),0);
 assert.equal((await scan(employees[0],token)).action,'check_in');
});

test('expiry, session logout, and issuer grant revocation still invalidate shared codes',async()=>{
 let token=await issue();
 await q("UPDATE attendance_tokens SET created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute'");
 await assert.rejects(scan(employees[0],token),e=>e.code==='token_expired');
 token=await issue();await q("UPDATE access_grants SET revoked_at=now(),revoked_by_user_id=user_id,revoke_reason='Test revocation' WHERE user_id=$1",[adminId]);
 await assert.rejects(scan(employees[0],token),e=>e.code==='invalid_token');
 await q("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[adminId]);
 await scan(employees[0],token);await q("DELETE FROM sessions WHERE id='issuer'");
 assert.equal(await count('attendance_token_scans'),0);
 await assert.rejects(scan(employees[1],token),e=>e.code==='invalid_token');
});

test('legacy consumed tokens remain invalid after the migration',async()=>{
 const token=await issue();
 await q('UPDATE attendance_tokens SET used_at=now(),used_by_employee_id=$1',[employees[0].id]);
 await assert.rejects(scan(employees[1],token),e=>e.code==='token_used');
});
