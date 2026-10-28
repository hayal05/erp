import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listOwnPayslips,loadOwnPayslip} from '../src/services/payslips.js';
import {ENTRY_FIELDS} from '../src/services/payrollDraft.js';
test('payslip listing binds the authenticated user and filters only released periods',async()=>{
 const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.startsWith('SELECT count')?[{total:1}]:[{id:'7',month:'2026-10',status:'paid',net_minor:'225000',currency_code:'ETB'}]};}};
 const r=await listOwnPayslips(db,{userId:4,page:2,pageSize:12});
 assert.deepEqual(calls[0].params,[4,12,12]);assert.deepEqual(calls[1].params,[4]);
 assert.ok(calls.every(c=>c.sql.includes("e.user_id=$1 AND p.status IN ('approved','paid')")));
 assert.equal(r.items[0].netMinor,225000);assert.equal(r.total,1);
});
test('unowned, draft or nonexistent payslips return 404 before loading salary detail',async()=>{
 let n=0;await assert.rejects(loadOwnPayslip({query:async(sql,params)=>{n++;assert.deepEqual(params,[7,4]);assert.ok(sql.includes("e.user_id=$2 AND p.status IN ('approved','paid')"));return {rows:[]};}},{userId:4,entryId:7}),{status:404});assert.equal(n,1);
});
test('own detail returns stored salary only, never the all-employee configuration snapshot',async()=>{
 const row={id:'7',employee_id:'2',employee_code:'E2',employee_name:'Own Employee',month:'2026-10',period_status:'approved',currency_code:'ETB'};
 for(const k of ENTRY_FIELDS)row[k.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`)]='0';
 const db={query:async sql=>({rows:sql.includes('WHERE pe.id=')?[{period_id:'1',approved_at:'2026-10-28',paid_on:null}]:sql.includes('JOIN payroll_periods')?[row]:[]})};
 const r=await loadOwnPayslip(db,{userId:4,entryId:7});assert.equal(r.entry.employeeName,'Own Employee');assert.equal(r.period.status,'approved');assert.equal(r.paidOn,null);
 assert.ok(!JSON.stringify(r).includes('configSnapshot'));assert.deepEqual(r.items,[]);
});
