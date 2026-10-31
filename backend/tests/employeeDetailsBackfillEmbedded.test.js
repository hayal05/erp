import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
const dir=new URL('../../database/migrations/',import.meta.url);
const script=await fs.readFile(new URL('018_required_employee_personal_details.sql',dir),'utf8');
const db=new PGlite({extensions:{btree_gist}});let shift,xyz,er5,other;
async function schema(connection){for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')&&f<'018_').sort())await connection.exec(await fs.readFile(new URL(f,dir),'utf8'));}
async function person(username,code){const user=(await db.query("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$1,'fixture-only-hash','employee') RETURNING id",[username])).rows[0].id;return (await db.query("INSERT INTO employees(employee_code,user_id,start_date,shift_id) VALUES($1,$2,'2020-01-01',$3) RETURNING id",[code,user,shift])).rows[0].id;}
before(async()=>{await schema(db);shift=(await db.query("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','08:00','17:00') RETURNING id")).rows[0].id;xyz=await person('XYZ','E001');er5=await person('another-login','ER5');other=await person('unrelated','E003');});
after(()=>db.close());
test('backfill uses supplied values for username or employee code and leaves other employees alone',async()=>{
 await db.exec(script);
 const rows=(await db.query("SELECT id,gender,to_char(date_of_birth,'YYYY-MM-DD') AS dob,field_of_study FROM employees ORDER BY id")).rows;
 assert.deepEqual(rows.map(r=>[Number(r.id),r.gender,r.dob,r.field_of_study]),[[Number(xyz),'male','1995-11-05','Accounting'],[Number(er5),'female','2000-10-21','Management'],[Number(other),null,null,null]]);
});
test('an ambiguous identifier aborts the backfill and rolls back earlier updates',async()=>{
 await db.query("UPDATE employees SET field_of_study='Before retry' WHERE id=$1",[xyz]);
 await person('er5','E004');
 await assert.rejects(db.exec(script),/matches multiple employees/);
 assert.equal((await db.query('SELECT field_of_study FROM employees WHERE id=$1',[xyz])).rows[0].field_of_study,'Before retry');
});
test('fresh installation with neither identifier can run the migration',async()=>{
 const fresh=new PGlite({extensions:{btree_gist}});try{await schema(fresh);await fresh.exec(script);assert.equal(Number((await fresh.query('SELECT count(*) n FROM employees')).rows[0].n),0);}finally{await fresh.close();}
});
