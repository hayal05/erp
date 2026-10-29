import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/account_safeguards_test';
const db=new PGlite({extensions:{btree_gist}}),{pool}=await import('../src/db/pool.js');const q=(s,p)=>db.query(s,p);pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{signIn}=await import('./hrClient.js');
let admin,staff,root,hr,finance,normal,shift;
const creds=email=>({email,password:'password-123'});
async function employee(code,role){
 const r=await admin.post('/api/employees').send({employeeCode:code,fullName:code,email:code+'@safe.test',password:'password-123',startDate:'2026-01-01',employmentType:'full_time',shiftId:shift});
 assert.equal(r.status,201,JSON.stringify(r.body));const e=r.body;
 await q('UPDATE users SET must_change_password=false WHERE id=$1',[e.userId]);
 if(role)await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[e.userId,role,root]);return e;
}
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 root=(await seedAdmin(creds('root@safe.test'))).id;admin=await signIn(app,creds('root@safe.test'));
 shift=(await admin.post('/api/shifts').send({name:'Day',startTime:'09:00',endTime:'17:00',workDays:[1,2,3,4,5],graceMinutes:0})).body.id;
 hr=await employee('hr','hr');finance=await employee('finance','finance');normal=await employee('normal');staff=await signIn(app,creds('hr@safe.test'));
});
after(async()=>db.close());
test('database rejects disabling or revoking the only active Admin',async()=>{
 await assert.rejects(q('UPDATE users SET is_active=false WHERE id=$1',[root]),/last active Admin/);
 await assert.rejects(q("UPDATE access_grants SET revoked_at=now(),revoked_by_user_id=$1,revoke_reason='Attempt' WHERE user_id=$1 AND access_role='admin' AND revoked_at IS NULL",[root]),/last active Admin/);
 assert.equal((await admin.get('/api/access-management/employees')).status,200);
});
test('HR cannot alter privileged login email or activation, but can manage ordinary employee status and job facts',async()=>{
 assert.equal((await staff.patch(`/api/employees/${finance.id}`).send({email:'taken@safe.test'})).status,403);
 assert.equal((await staff.post(`/api/employees/${finance.id}/deactivate`).send({reason:'Disable'})).status,403);
 assert.equal((await staff.patch(`/api/employees/${finance.id}`).send({phone:'0911111111'})).status,200);
 assert.equal((await staff.post(`/api/employees/${normal.id}/deactivate`).send({reason:'Employment ended'})).status,200);
 assert.equal((await staff.post(`/api/employees/${normal.id}/activate`).send({reason:'Returned'})).status,200);
 assert.equal((await admin.post(`/api/employees/${finance.id}/deactivate`).send({reason:'Admin decision'})).status,200);
 assert.equal((await staff.post(`/api/employees/${finance.id}/activate`).send({reason:'Try to restore'})).status,403);
 assert.equal((await admin.post(`/api/employees/${finance.id}/activate`).send({reason:'Restore'})).status,200);
});
test('inactive employee records invalidate existing privileged sessions even if user flag is unchanged',async()=>{
 const person=await signIn(app,creds('finance@safe.test'));assert.equal((await person.get('/api/settlements')).status,200);
 await q("UPDATE employees SET status='inactive' WHERE id=$1",[finance.id]);
 assert.equal((await person.get('/api/settlements')).status,401);assert.equal((await person.get('/api/auth/me')).status,401);
 await q("UPDATE employees SET status='active' WHERE id=$1",[finance.id]);
});
test('last-Admin protection covers employee status, HTTP deactivation and user activation; inactive alternatives do not count',async()=>{
 const other=await employee('otheradmin','admin');const otherClient=await signIn(app,creds('otheradmin@safe.test'));
 await q('UPDATE users SET is_active=false WHERE id=$1',[root]); // second active Admin exists
 assert.equal((await otherClient.post(`/api/employees/${other.id}/deactivate`).send({reason:'Self disable'})).status,409);
 await assert.rejects(q("UPDATE employees SET status='inactive' WHERE id=$1",[other.id]),/last active Admin/);
 await assert.rejects(q('UPDATE users SET is_active=false WHERE id=$1',[other.userId]),/last active Admin/);
 await assert.rejects(q("UPDATE access_grants SET revoked_at=now(),revoked_by_user_id=$2,revoke_reason='Remove last' WHERE user_id=$1 AND access_role='admin'",[other.userId,root]),/last active Admin/);
 await q('UPDATE users SET is_active=true WHERE id=$1',[root]);
 assert.equal((await otherClient.post(`/api/employees/${other.id}/deactivate`).send({reason:'Another Admin remains'})).status,200);
 assert.equal((await otherClient.get('/api/auth/me')).status,401);
});
