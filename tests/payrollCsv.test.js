import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CSV_COLUMNS,csvText,payrollCsv,loadPayrollCsv} from '../src/services/payrollCsv.js';
import {ENTRY_FIELDS} from '../src/services/payrollDraft.js';
const entry={employeeCode:'E1',employeeName:'ሃና, "Test"',basicMinor:250050,allowanceMinor:0,incomeTaxMinor:22500,otherTaxMinor:100,employeePensionMinor:12500,otherDeductionsMinor:300000,netMinor:-85050};
test('CSV uses exact nine sheet columns, Unicode BOM, escaped text and exact ungrouped amounts',()=>{
 assert.deepEqual(CSV_COLUMNS.map(([,h])=>h),['Employee ID','Employee Name','Basic Salary','Allowance','Income Tax','Other Tax','Pension','Other Deductions','Net Salary']);
 const csv=payrollCsv([entry]);assert.ok(csv.startsWith('\uFEFF"Employee ID"'));
 assert.ok(csv.includes('"ሃና, ""Test"""'));
 assert.ok(csv.endsWith('2500.50,0.00,225.00,1.00,125.00,3000.00,-850.50\r\n'));
 assert.equal(payrollCsv([]).split('\r\n').length,2);
});
test('employee text cannot become spreadsheet formulas; quotes and embedded newlines are preserved',()=>{
 for(const s of ['=1+1','+cmd','-1+2','@SUM(A1)','  =1','\ttext','\rtext']) assert.ok(csvText(s).startsWith('"\''),JSON.stringify(s));
 assert.equal(csvText('Normal'), '"Normal"');
 assert.equal(csvText('Line 1\nLine 2'), '"Line 1\nLine 2"');
});
test('export reads every stored entry without LIMIT or live settings and rejects missing periods',async()=>{
 const calls=[];
 const rows=Array.from({length:52},(_,i)=>{const r={id:String(i+1),employee_id:String(i+1),employee_code:`E${i+1}`,employee_name:'Employee'};for(const k of ENTRY_FIELDS)r[k.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`)]='0';return r;});
 const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.includes('FROM payroll_periods')?[{month:'2026-10'}]:rows};}};
 const result=await loadPayrollCsv(db,1);
 assert.equal(result.filename,'payroll-2026-10.csv');assert.equal(result.csv.split('\r\n').length,54);
 assert.ok(!calls[1].sql.includes('LIMIT'));assert.ok(calls[1].sql.includes('ORDER BY employee_id'));
 await assert.rejects(loadPayrollCsv({query:async()=>({rows:[]})},999),{status:404});
});
