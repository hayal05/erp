import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {loadDashboard} from '../src/services/dashboard.js';
const db=new PGlite({extensions:{btree_gist}}),now='2026-11-04T09:00:00Z';
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 for(const f of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(f,dir),'utf8'));
});
after(()=>db.close());
test('unconfigured retirement is distinct from a configured empty workforce',async()=>{
 assert.deepEqual((await loadDashboard(db,{now})).retirement,{retirementAge:null,nearing:null,passed:null});
 await db.query('UPDATE retirement_settings SET retirement_age=60 WHERE id=1');
 assert.deepEqual((await loadDashboard(db,{now})).retirement,{retirementAge:60,nearing:0,passed:0});
});
test('one card counts active employees once at exact three-calendar-month and retirement boundaries',async()=>{
 const shift=(await db.query("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','08:00','17:00') RETURNING id")).rows[0].id;
 const cases=[['today','1966-11-04','active'],['past','1966-11-03','active'],['tomorrow','1966-11-05','active'],['boundary','1967-02-04','active'],['outside','1967-02-05','active'],['inactive','1966-11-03','inactive'],['missing',null,'active'],['invalid-future','2027-01-01','active']];
 for(const [name,dob,status] of cases){
  const user=(await db.query("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$1,'fixture-only-hash','employee') RETURNING id",[name])).rows[0].id;
  await db.query("INSERT INTO employees(employee_code,user_id,date_of_birth,status,shift_id,start_date) VALUES($1,$2,$3,$4,$5,'2020-01-01')",[name,user,dob,status,shift]);
 }
 const d=await loadDashboard(db,{now});assert.equal(d.stats.totalEmployees,8);assert.deepEqual(d.retirement,{retirementAge:60,nearing:2,passed:2});
 // 22:00 UTC is already the next calendar date in the company timezone.
 assert.deepEqual((await loadDashboard(db,{now:'2026-11-03T22:00:00Z'})).retirement,d.retirement);
 await db.query('UPDATE retirement_settings SET retirement_age=61 WHERE id=1');
 assert.deepEqual((await loadDashboard(db,{now})).retirement,{retirementAge:61,nearing:0,passed:0});
});
