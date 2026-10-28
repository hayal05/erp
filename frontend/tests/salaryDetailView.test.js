import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailBreakdown } from '../src/pages/salaryDetailView.js';
const entry = { grossMinor: 300000, incomeTaxMinor: 22500, otherTaxMinor: 3000, employeePensionMinor: 12500, otherDeductionsMinor: 7000, netMinor: 255000, employerPensionMinor: 25000, employerCostMinor: 325000 };
const items = [{ kind:'other_tax',amountMinor:3000 },{ kind:'advance',amountMinor:5000 },{ kind:'unpaid_leave',amountMinor:2000 }];
test('salary detail reconciles item groups and separates employee deductions from employer pension', () => {
  const b=detailBreakdown({entry,items});
  assert.equal(b.taxTotal,3000); assert.equal(b.deductionTotal,7000);
  assert.equal(b.totalEmployeeDeductions,45000); assert.equal(b.matches,true);
  assert.equal(b.taxes.length,1); assert.equal(b.deductions.length,2);
});
test('salary detail detects missing breakdown and supports zero items or negative net salary', () => {
  assert.equal(detailBreakdown({entry,items:[]}).matches,false);
  const zero={grossMinor:0,incomeTaxMinor:0,otherTaxMinor:0,employeePensionMinor:0,otherDeductionsMinor:0,netMinor:0,employerPensionMinor:0,employerCostMinor:0};
  assert.equal(detailBreakdown({entry:zero,items:[]}).matches,true);
  assert.equal(detailBreakdown({entry:{...zero,otherDeductionsMinor:100,netMinor:-100},items:[{kind:'loan',amountMinor:100}]}).matches,true);
});
