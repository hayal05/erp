import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgres://unused/admin_profile';
const db=new PGlite({extensions:{btree_gist}}),q=(sql,args)=>db.query(sql,args);
const {pool}=await import('../src/db/pool.js');pool.query=q;pool.connect=async()=>({query:q,release(){}});
const {app}=await import('../src/server.js'),{seedAdmin}=await import('../src/db/seed.js'),{hashPassword}=await import('../src/services/password.js'),{signIn}=await import('./hrClient.js');
const {default:request}=await import('supertest');
const password='password-123';let admin,hr,finance,plain,target,legacy,root;
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
 root=(await seedAdmin({username:'root',password})).id;admin=await signIn(app,{username:'root',password});
 const shift=(await q("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','08:00','17:00') RETURNING id")).rows[0].id;
 const department=(await q("INSERT INTO departments(name) VALUES('Economics') RETURNING id")).rows[0].id;
 const hash=await hashPassword(password);
 for(const name of ['hr','finance','plain','target','legacy']){
  const u=(await q("INSERT INTO users(username,full_name,password_hash,role,email) VALUES($1,$2,$3,'employee',$4) RETURNING id",[`${name}.profile`,`${name} employee`,hash,`${name}@example.test`])).rows[0].id;
  const e=(await q("INSERT INTO employees(employee_code,user_id,start_date,shift_id,department_id,job_title,gender,date_of_birth,field_of_study,phone,experience_summary,status) VALUES($1,$2,'2020-01-01',$3,$4,'Analyst',$5,$6,$7,$8,$9,$10) RETURNING id",[name,u,shift,department,name==='legacy'?null:'female',name==='legacy'?null:'1995-11-05',name==='legacy'?null:'Economics',name==='legacy'?null:'+251900000000',name==='target'?'Previous work in planning.':'',name==='target'?'inactive':'active'])).rows[0].id;
  if(name==='hr'||name==='finance')await q('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3)',[u,name,root]);
  if(name==='target')target=Number(e);else if(name==='legacy')legacy=Number(e);else{const c=await signIn(app,{username:`${name}.profile`,password});if(name==='hr')hr=c;else if(name==='finance')finance=c;else plain=c;}
 }
 await q('DELETE FROM employee_position_history WHERE employee_id=$1',[target]);
 for(let n=0;n<12;n++)await q("INSERT INTO employee_position_history(employee_id,department_name,position_name,recorded_at,is_baseline) VALUES($1,'Historic department',$2,'2025-01-01T22:30:00Z',$3)",[target,`Role ${n}`,n===0]);
});
after(()=>db.close());
test('HR, Finance and Admin can read an inactive employee profile without credentials or salary data',async()=>{
 for(const client of [admin,hr,finance]){
  const r=await client.get(`/api/employees/${target}/profile?pageSize=10`);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.headers['cache-control'],'no-store');
  for(const [field,value] of Object.entries({fullName:'target employee',username:'target.profile',gender:'female',dateOfBirth:'1995-11-05',fieldOfStudy:'Economics',phone:'+251900000000',departmentName:'Economics',jobTitle:'Analyst',shiftName:'Day',status:'inactive',experienceSummary:'Previous work in planning.'}))assert.equal(r.body[field],value,field);
  assert.match(r.body.today,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.body.positionHistory.total,12);assert.equal(r.body.positionHistory.items.length,10);
  assert.ok(!/password|hash|salary|token/i.test(JSON.stringify(r.body)));
 }
});
test('profile history is isolated, stable across pages, preserves names and uses company dates',async()=>{
 const first=(await hr.get(`/api/employees/${target}/profile?pageSize=10`)).body;
 const next=(await hr.get(`/api/employees/${target}/profile?page=2&pageSize=10`)).body;
 assert.equal(next.positionHistory.items.length,2);assert.equal(new Set([...first.positionHistory.items,...next.positionHistory.items].map(i=>i.id)).size,12);
 assert.equal(first.positionHistory.items[0].position,'Role 11');assert.equal(first.positionHistory.items[0].department,'Historic department');assert.equal(first.positionHistory.items[0].recordedOn,'2025-01-02');assert.equal(next.positionHistory.items[1].baseline,true);
 const old=(await hr.get(`/api/employees/${legacy}/profile`)).body;assert.equal(old.dateOfBirth,null);assert.equal(old.fieldOfStudy,null);assert.equal(old.experienceSummary,'');assert.equal(old.positionHistory.total,1);
 await q('UPDATE employees SET experience_summary=$2 WHERE id=$1',[target,'Updated employee experience']);
 assert.equal((await hr.get(`/api/employees/${target}/profile`)).body.experienceSummary,'Updated employee experience');
});
test('anonymous, ordinary employees, invalid IDs/pages and locked sessions cannot access admin profiles',async()=>{
 const path=`/api/employees/${target}/profile`;
 assert.equal((await request(app).get(path)).status,401);assert.equal((await plain.get(path)).status,403);
 assert.equal((await hr.get('/api/employees/999999/profile')).status,404);
 for(const url of ['/api/employees/bad/profile',path+'?page=0',path+'?pageSize=101'])assert.equal((await hr.get(url)).status,400,url);
 assert.equal((await hr.post('/api/qr/lock').send({})).status,200);assert.equal((await hr.get(path)).status,423);
});
