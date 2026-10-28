import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPayrollDetail } from '../src/services/payrollDetails.js';
import { ENTRY_FIELDS } from '../src/services/payrollDraft.js';
test('detail maps stored amounts and breakdown without reading live config or source deductions',async()=>{
 const calls=[],row={id:'2',employee_id:'4',employee_code:'E4',employee_name:'Employee',period_status:'approved',month:'2026-10',currency_code:'ETB'};
 for(const k of ENTRY_FIELDS) row[k.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`)]='100';
 const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.includes('JOIN payroll_periods')?[row]:[{id:'3',kind:'loan',label:'Old loan name',rate:null,base_minor:null,amount_minor:'5000',source_id:'7'}]};}};
 const result=await loadPayrollDetail(db,{periodId:1,entryId:2});
 assert.equal(result.entry.employerCostMinor,100);
 assert.deepEqual(result.items,[{id:3,kind:'loan',label:'Old loan name',rate:null,baseMinor:null,amountMinor:5000,sourceId:7}]);
 assert.deepEqual(result.period,{id:1,month:'2026-10',status:'approved',currencyCode:'ETB'});
 assert.deepEqual(calls[0].params,[2,1]); assert.equal(calls.length,2);
});
test('detail hides missing and cross-period entry IDs behind 404',async()=>{
 let calls=0;
 await assert.rejects(loadPayrollDetail({query:async()=>{calls++;return {rows:[]};}},{periodId:1,entryId:99}),{status:404});
 assert.equal(calls,1);
});
