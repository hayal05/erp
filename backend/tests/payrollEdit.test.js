import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntryEdit, editDraftEntry } from '../src/services/payrollEdit.js';
import { ENTRY_FIELDS } from '../src/services/payrollDraft.js';
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const settings = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 5, companyPensionRate: 10 };
const brackets = [{ fromMinor: 0, toMinor: null, rate: 15, fixedDeductionMinor: 15000 }];
const input = { periodId: 1, entryId: 2, actorId: 3, changes: { basicMinor: 300000 }, settings, brackets, otherTaxes: [{ id: 8, name: 'Tax', rate: 1, base: 'gross', enabled: true }] };
function fixture({ status = 'draft', missingPeriod = false, missingEntry = false } = {}) {
  const calls = [];
  const row = { id: '2', employee_id: '4', employee_code: 'E4', employee_name: 'Employee' };
  for (const key of ENTRY_FIELDS) row[snake(key)] = '0';
  row.basic_minor = '250000'; row.allowance_minor = '10000';
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM payroll_periods')) return { rows: missingPeriod ? [] : [{ status, month: '2026-01' }] };
    if (sql.includes('SELECT * FROM payroll_entries')) return { rows: missingEntry ? [] : [row] };
    if (sql.includes('FROM salary_profiles')) return { rows: [{ employee_id: '4', basic_minor: '999999', allowance_minor: '999999', pension_applies: true, allowance_taxable: true, allowance_pensionable: true }] };
    if (sql.includes('SELECT * FROM payroll_entry_items')) return { rows: [{ kind: 'advance', label: 'Consumed advance', amount_minor: '2000', source_id: '7' }] };
    if (sql.startsWith('UPDATE payroll_entries')) return { rows: [{ ...row, ...Object.fromEntries(ENTRY_FIELDS.map((k, i) => [snake(k), String(params[i + 1])])) }] };
    if (sql.startsWith('WITH days')) return { rows: [{ working_days: 20, absent_days: 1, unpaid_days: 1 }] };
    if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ id: 1 }] };
    return { rows: [], rowCount: 1 };
  } };
  return { db, calls };
}
test('draft edit validates exact amounts, strips derived totals and rejects empty edits', () => {
  assert.deepEqual(parseEntryEdit({ basicMinor: 0, netMinor: 900, employeeId: 5 }).value, { basicMinor: 0 });
  for (const bad of [-1, 0.5, '100', 10000000000000]) assert.ok(parseEntryEdit({ allowanceMinor: bad }).errors);
  for (const body of [{}, { netMinor: 100 }, null, []]) assert.ok(parseEntryEdit(body).errors);
});
test('draft edit recalculates all amounts while preserving omitted salary and allocated deductions', async () => {
  const { db, calls } = fixture();
  const result = await editDraftEntry(db, input);
  assert.equal(result.basicMinor, 300000);
  assert.equal(result.allowanceMinor, 10000);
  assert.equal(result.grossMinor, 310000);
  assert.equal(result.incomeTaxMinor, 30000);
  assert.equal(result.employeePensionMinor, 15000);
  assert.equal(result.employerPensionMinor, 30000);
  assert.equal(result.otherTaxMinor, 3100);
  assert.equal(result.otherDeductionsMinor, 2000);
  assert.equal(result.netMinor, 259900);
  assert.equal(result.employerCostMinor, 340000);
  assert.ok(calls.find((c) => c.sql.startsWith('DELETE')).sql.includes("'absence','unpaid_leave'"));
  assert.equal(calls.filter((c) => c.sql.includes('INSERT INTO payroll_entry_items')).length, 1);
  assert.ok(!calls.some((c) => /UPDATE (salary_profiles|deduction_items)/.test(c.sql)));
  assert.ok(calls.at(-1).sql.includes('audit_logs'));
});
test('approved and paid entries reject recalculation before writes', async () => {
  for (const status of ['approved', 'paid']) {
    const { db, calls } = fixture({ status });
    await assert.rejects(editDraftEntry(db, input), { status: 409 });
    assert.equal(calls.length, 1);
  }
});
test('missing periods or mismatched entries return 404 without writes', async () => {
  for (const options of [{ missingPeriod: true }, { missingEntry: true }]) {
    const { db, calls } = fixture(options);
    await assert.rejects(editDraftEntry(db, input), { status: 404 });
    assert.ok(!calls.some((c) => /^(UPDATE|DELETE|INSERT)/.test(c.sql)));
  }
});
test('invalid brackets abort before writes, including for a same-value edit', async () => {
  const { db, calls } = fixture();
  await assert.rejects(editDraftEntry(db, { ...input, changes: { basicMinor: 250000 }, brackets: [] }), { status: 422, code: 'invalid_brackets' });
  assert.ok(!calls.some((c) => /^(UPDATE|DELETE|INSERT)/.test(c.sql)));
});

test('draft recalculation replaces computed attendance deductions instead of accumulating them', async () => {
  const { db, calls } = fixture();
  const options = { ...input, settings: { ...settings, absenceDeductionEnabled: true, unpaidLeaveDeductionEnabled: true } };
  const first = await editDraftEntry(db, options);
  const second = await editDraftEntry(db, options);
  assert.equal(first.otherDeductionsMinor, 32000);
  assert.equal(second.otherDeductionsMinor, 32000);
  assert.equal(first.netMinor, second.netMinor);
  const deletes = calls.filter((c) => c.sql.startsWith('DELETE'));
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every((c) => c.sql.includes("'absence','unpaid_leave'")));
});
