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
const {attachmentDeps}=await import('../src/routes/employeeAttachments.js');
const files=new Map();let uploaded=0;attachmentDeps.store={upload:async f=>{const id=`private-file-${++uploaded}`;files.set(id,f.bytes);return id;},download:async id=>files.get(id),delete:async id=>files.delete(id)};
const pdf=Buffer.from('%PDF-1.7\nEmployment letter\n%%EOF');
const fileBody=extra=>({direction:'incoming',fileName:'Employment letter.pdf',fileBase64:pdf.toString('base64'),...extra});
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
test('attachment uploads are private, scoped to employee and direction, paginated, and downloadable by management',async()=>{
 const before=uploaded;
 const incoming=await admin.post(`/api/employees/${target}/attachments`).send(fileBody());assert.equal(incoming.status,201,JSON.stringify(incoming.body));
 const outgoing=await admin.post(`/api/employees/${target}/attachments`).send(fileBody({direction:'outgoing',fileName:'Response.pdf'}));assert.equal(outgoing.status,201);
 assert.equal(uploaded,before+2);
 const list=await finance.get(`/api/employees/${target}/attachments?direction=incoming&pageSize=1`);assert.equal(list.status,200);assert.equal(list.body.total,1);assert.equal(list.body.items[0].fileName,'Employment letter.pdf');assert.ok(!JSON.stringify(list.body).includes('private-file'));
 assert.equal((await finance.get(`/api/employees/${target}/attachments?direction=outgoing`)).body.items[0].fileName,'Response.pdf');
 const download=await finance.get(`/api/employees/${target}/attachments/${incoming.body.id}/download`);assert.equal(download.status,200);assert.equal(download.headers['content-type'],'application/pdf');assert.ok(download.headers['content-disposition'].startsWith('attachment;'));assert.deepEqual(download.body,pdf);
 assert.equal((await finance.get(`/api/employees/${legacy}/attachments/${incoming.body.id}/download`)).status,404);
 assert.equal((await plain.get(`/api/employees/${target}/attachments?direction=incoming`)).status,403);
 assert.equal((await finance.post(`/api/employees/${target}/attachments`).send(fileBody())).status,403);
 const logs=await hr.get('/api/audit-history?area=employees');assert.ok(logs.body.items.some(i=>i.type==='employee_attachment'));
});
test('HR file proposals retain encrypted content, allow reviewer downloads and publish only after approval',async()=>{
 const before=uploaded;
 const proposed=await hr.post(`/api/employees/${target}/attachments`).send(fileBody({fileName:'Approval letter.pdf'}));assert.equal(proposed.status,202,JSON.stringify(proposed.body));assert.equal(uploaded,before);
 const id=proposed.body.requestId;
 const pending=(await q('SELECT payload_cipher,payload_preview FROM change_requests WHERE id=$1',[id])).rows[0];assert.equal(pending.payload_preview.fileBase64,'[protected]');assert.ok(!pending.payload_cipher.includes(pdf.toString('base64')));
 assert.equal((await finance.get(`/api/employees/${target}/attachments?direction=incoming`)).body.total,1);
 const preview=await admin.get(`/api/change-requests/${id}/attachment`);assert.equal(preview.status,200);assert.deepEqual(preview.body,pdf);
 assert.equal((await hr.get(`/api/change-requests/${id}/attachment`)).status,200);assert.equal((await finance.get(`/api/change-requests/${id}/attachment`)).status,404);
 assert.equal((await hr.post(`/api/change-requests/${id}/approve`).send({})).status,403);
 const approved=await admin.post(`/api/change-requests/${id}/approve`).send({});assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(uploaded,before+1);
 assert.equal((await finance.get(`/api/employees/${target}/attachments?direction=incoming`)).body.total,2);
 assert.equal((await admin.get(`/api/change-requests/${id}/attachment`)).status,404);assert.equal((await q('SELECT payload_cipher FROM change_requests WHERE id=$1',[id])).rows[0].payload_cipher,null);
});
test('invalid uploads do not queue or reach storage; withdrawn proposals never publish',async()=>{
 const before=uploaded;
 for(const body of [fileBody({fileName:'x.exe'}),fileBody({fileName:'x.png'}),fileBody({direction:'bad'})])assert.equal((await hr.post(`/api/employees/${target}/attachments`).send(body)).status,400);
 assert.equal((await admin.post('/api/employees/999999/attachments').send(fileBody())).status,404);
 const proposed=await hr.post(`/api/employees/${target}/attachments`).send(fileBody({fileName:'Withdrawn.pdf'}));assert.equal(proposed.status,202);
 assert.equal((await hr.post(`/api/change-requests/${proposed.body.requestId}/cancel`).send({})).status,200);
 assert.equal((await admin.get(`/api/change-requests/${proposed.body.requestId}/attachment`)).status,404);assert.equal(uploaded,before);
});
test('approval rollback removes uploaded objects and leaves the proposal available for retry',async()=>{
 const proposed=await hr.post(`/api/employees/${target}/attachments`).send(fileBody({fileName:'Retry letter.pdf'}));assert.equal(proposed.status,202);
 const before=files.size,count=(await q('SELECT count(*)::int AS n FROM employee_attachments')).rows[0].n;
 await db.exec(`CREATE FUNCTION fail_attachment_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='change.approve' AND NEW.entity_type='employee_attachment' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END; $$; CREATE TRIGGER attachment_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_attachment_approval();`);
 assert.equal((await admin.post(`/api/change-requests/${proposed.body.requestId}/approve`).send({})).status,500);
 assert.equal(files.size,before);assert.equal((await q('SELECT count(*)::int AS n FROM employee_attachments')).rows[0].n,count);
 await db.exec('DROP TRIGGER attachment_failure ON audit_logs; DROP FUNCTION fail_attachment_approval();');
 assert.equal((await admin.post(`/api/change-requests/${proposed.body.requestId}/approve`).send({})).status,200);
});
test('authorized document uploads can exceed the ordinary 100 KB JSON cap; storage errors leave no metadata',async()=>{
 const larger=Buffer.concat([pdf,Buffer.alloc(150*1024)]),body=fileBody({fileName:'Large letter.pdf',fileBase64:larger.toString('base64')});
 const path=`/api/employees/${target}/attachments`;
 assert.equal((await request(app).post(path).send(body)).status,401);
 assert.equal((await finance.post(path).send(body)).status,403);
 const saved=await admin.post(path).send(body);assert.equal(saved.status,201,JSON.stringify(saved.body));
 assert.equal((await finance.get(`${path}/${saved.body.id}/download`)).body.length,larger.length);
 const count=(await q('SELECT count(*)::int AS n FROM employee_attachments')).rows[0].n,original=attachmentDeps.store.upload;
 attachmentDeps.store.upload=async()=>{throw new Error('Provider upload failed');};
 try{assert.equal((await admin.post(path).send(fileBody({fileName:'Failed.pdf'}))).status,500);}finally{attachmentDeps.store.upload=original;}
 assert.equal((await q('SELECT count(*)::int AS n FROM employee_attachments')).rows[0].n,count);
});
test('independent incoming and outgoing proposals can both be approved without making each other stale',async()=>{
 const incoming=await hr.post(`/api/employees/${target}/attachments`).send(fileBody({fileName:'Concurrent incoming.pdf'}));
 const outgoing=await hr.post(`/api/employees/${target}/attachments`).send(fileBody({direction:'outgoing',fileName:'Concurrent outgoing.pdf'}));
 assert.equal(incoming.status,202);assert.equal(outgoing.status,202);
 for(const id of [incoming.body.requestId,outgoing.body.requestId]){const approved=await admin.post(`/api/change-requests/${id}/approve`).send({});assert.equal(approved.status,200,JSON.stringify(approved.body));}
});
test('anonymous, ordinary employees, invalid IDs/pages and locked sessions cannot access admin profiles',async()=>{
 const path=`/api/employees/${target}/profile`;
 assert.equal((await request(app).get(path)).status,401);assert.equal((await plain.get(path)).status,403);
 assert.equal((await hr.get('/api/employees/999999/profile')).status,404);
 for(const url of ['/api/employees/bad/profile',path+'?page=0',path+'?pageSize=101'])assert.equal((await hr.get(url)).status,400,url);
 assert.equal((await hr.post('/api/qr/lock').send({})).status,200);assert.equal((await hr.get(path)).status,423);
});
