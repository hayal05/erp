import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SALARY_COLUMNS, periodIdFromParam, salaryEditForm, salaryEditPayload, canEditSalary } from '../src/pages/salarySheetView.js';
test('salary sheet has exactly nine required columns with employee pension and two editable inputs', () => {
  assert.deepEqual(SALARY_COLUMNS.map((c) => c.header), ['Employee ID','Employee Name','Basic Salary','Allowance','Income Tax','Other Tax','Pension','Other Deductions','Net Salary']);
  assert.equal(SALARY_COLUMNS[6].key, 'employeePensionMinor');
  assert.deepEqual(SALARY_COLUMNS.filter((c) => c.editable).map((c) => c.key), ['basicMinor','allowanceMinor']);
  assert.ok(canEditSalary({ status: 'draft' }));
  for (const status of ['approved','paid',undefined]) assert.ok(!canEditSalary({ status }));
});
test('salary edits send exact minor units, allow zero and reject invalid money', () => {
  const value = { basicMinor: 250050, allowanceMinor: 0 };
  assert.deepEqual(salaryEditPayload(salaryEditForm(value)), { value });
  assert.deepEqual(Object.keys(salaryEditPayload({ basicMinor: '-1', allowanceMinor: '1.234' }).errors), ['basicMinor','allowanceMinor']);
});
test('period links reject malformed and unsafe IDs rather than fetching another period', () => {
  assert.equal(periodIdFromParam(null), null);
  assert.equal(periodIdFromParam('12'), 12);
  for (const bad of ['0','-1','1.5','1x','1e2','9007199254740993','']) assert.equal(periodIdFromParam(bad), false);
});
