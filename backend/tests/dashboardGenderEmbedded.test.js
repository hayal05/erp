import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {loadDashboard} from '../src/services/dashboard.js';
const db=new PGlite({extensions:{btree_gist}});
const now='2026-11-02T15:00:00Z';
before(async()=>{
 const dir=new URL('../../database/migrations/',import.meta.url);
 for(const file of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(new URL(file,dir),'utf8'));
});
after(()=>db.close());
test('empty dashboard returns zero counts and percentages',async()=>{
 const d=await loadDashboard(db,{now});
 assert.equal(d.stats.totalEmployees,0);
 assert.deepEqual(d.employeeDepartments,[]);
 assert.deepEqual(d.employeeGender,{male:{count:0,percentage:0},female:{count:0,percentage:0},unspecified:{count:0,percentage:0}});
});
test('gender share includes inactive and future employees like the total, preserves missing values and updates on reload',async()=>{
 const shift=(await db.query("INSERT INTO shifts(name,start_time,end_time) VALUES('Day','08:00','17:00') RETURNING id")).rows[0].id;
 for(const [index,gender,status,start] of [[1,'male','active','2020-01-01'],[2,'female','inactive','2020-01-01'],[3,null,'active','2027-01-01']]){
  const user=(await db.query("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$1,'fixture-only-hash','employee') RETURNING id",[`gender-${index}`])).rows[0].id;
  await db.query('INSERT INTO employees(employee_code,user_id,shift_id,gender,status,start_date) VALUES($1,$2,$3,$4,$5,$6)',[`G-${index}`,user,shift,gender,status,start]);
 }
 const d=await loadDashboard(db,{now});
 assert.equal(d.stats.totalEmployees,3);
 assert.deepEqual(d.employeeGender,{male:{count:1,percentage:33.3},female:{count:1,percentage:33.3},unspecified:{count:1,percentage:33.3}});
 await db.query("UPDATE employees SET gender='male' WHERE employee_code='G-3'");
 assert.deepEqual((await loadDashboard(db,{now})).employeeGender,{male:{count:2,percentage:66.7},female:{count:1,percentage:33.3},unspecified:{count:0,percentage:0}});
});

test('department chart totals match the full employee scope, including unassigned and inactive employees',async()=>{
 const depA=(await db.query("INSERT INTO departments(name) VALUES('Chart A') RETURNING id")).rows[0].id;
 const depB=(await db.query("INSERT INTO departments(name) VALUES('Chart B') RETURNING id")).rows[0].id;
 await db.query("UPDATE employees SET department_id=$1 WHERE employee_code IN ('G-1','G-2')",[depA]);
 await db.query("UPDATE employees SET department_id=$1 WHERE employee_code='G-3'",[depB]);
 const all=await loadDashboard(db,{now});
 assert.deepEqual(all.employeeDepartments.map(d=>[d.name,d.count]),[['Chart A',2],['Chart B',1]]);
 assert.deepEqual(all.employeeDepartments.map(d=>[d.male,d.female,d.unspecified]),[[1,1,0],[1,0,0]]);
 assert.equal(all.employeeDepartments.reduce((n,d)=>n+d.count,0),all.stats.totalEmployees);
 const user={accessRoles:[],customGrants:[{permissions:['dashboard.read'],scopeType:'departments',departmentIds:[Number(depA)],employeeIds:[]}]};
 const scoped=await loadDashboard(db,{now,user});
 assert.deepEqual(scoped.employeeDepartments.map(d=>[d.name,d.count]),[['Chart A',2]]);
 assert.deepEqual(scoped.employeeDepartments.map(d=>[d.male,d.female,d.unspecified]),[[1,1,0]]);
 assert.equal(scoped.stats.totalEmployees,2);
 assert.equal(scoped.employeeGender.male.count,1);
 assert.equal(scoped.employeeGender.female.count,1);
 await db.query("UPDATE employees SET gender=NULL WHERE employee_code='G-3'");
 await db.query("UPDATE employees SET department_id=NULL WHERE employee_code='G-3'");
 assert.deepEqual((await loadDashboard(db,{now})).employeeDepartments.map(d=>[d.name,d.count]),[['Chart A',2],['Unassigned',1]]);
 assert.equal((await loadDashboard(db,{now})).employeeDepartments.find(d=>d.name==='Unassigned').unspecified,1);
});
