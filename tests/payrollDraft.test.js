import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDraft, parsePeriodMonth, toEntry, ENTRY_FIELDS } from '../src/services/payrollDraft.js';
const settings = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 5, companyPensionRate: 10, roundingMode: 'half_up' };
const brackets = [{ fromMinor: 0, toMinor: null, rate: 15, fixedDeductionMinor: 15000 }];
const employee = { employee_id: '2', employee_code: 'E2', full_name: 'Employee', profile_id: '1', basic_minor: '250000', allowance_minor: '10000', allowance_taxable: true, allowance_pensionable: true, pension_applies: true };
test('payroll month validates format without date rollover', () => {
  assert.equal(parsePeriodMonth('2026-02'), '2026-02-01');
  for (const bad of ['2026-13', '2026-00', '2026-1', '2026-01-01', null, 2026, '0000-01']) assert.throws(() => parsePeriodMonth(bad), { status: 400 });
});
test('generation refuses invalid brackets and missing profiles before creating a period', async () => {
  let calls = 0;
  const db = { query: async () => { calls++; return { rows: [{ ...employee, profile_id: null }] }; } };
  await assert.rejects(generateDraft(db, { brackets: [] }), { code: 'invalid_brackets' });
  assert.equal(calls, 0);
  await assert.rejects(generateDraft(db, { brackets }), { code: 'missing_profiles' });
  assert.equal(calls, 1);
  await assert.rejects(generateDraft({ query: async () => ({ rows: [] }) }, { brackets }), { code: 'no_employees' });
});
test('generation persists authoritative amounts, breakdown, and consumes only one-time items', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM employees e')) return { rows: [employee] };
    if (sql.startsWith('INSERT INTO payroll_periods')) return { rows: [{ id: '3', month: '2026-10', status: 'draft' }] };
    if (sql.startsWith('SELECT * FROM deduction_items')) return { rows: [
      { id: '7', employee_id: '2', name: 'Loan', kind: 'loan', amount_minor: '5000', recurring: true },
      { id: '8', employee_id: '2', name: 'Advance', kind: 'advance', amount_minor: '2000', recurring: false }] };
    if (sql.startsWith('INSERT INTO payroll_entries')) return { rows: [{ id: '4' }] };
    if (sql.startsWith('SELECT id FROM deduction_items')) return { rows: [{ id: '8' }] };
    if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ id: '1' }] };
    return { rows: [], rowCount: 1 };
  } };
  const result = await generateDraft(db, { month: '2026-10-01', actorId: 1, settings, brackets, otherTaxes: [] });
  assert.deepEqual(result, { id: 3, month: '2026-10', status: 'draft', employeeCount: 1 });
  const insert = calls.find((c) => c.sql.startsWith('INSERT INTO payroll_entries'));
  const amounts = Object.fromEntries(ENTRY_FIELDS.map((k, i) => [k, insert.params[i + 4]]));
  assert.equal(amounts.incomeTaxMinor, 22500);
  assert.equal(amounts.employeePensionMinor, 12500);
  assert.equal(amounts.employerPensionMinor, 25000);
  assert.equal(amounts.netMinor, 218000);
  assert.equal(calls.filter((c) => c.sql.startsWith('INSERT INTO payroll_entry_items')).length, 2);
  assert.deepEqual(calls.find((c) => c.sql.startsWith('UPDATE deduction_items')).params, [3, [8]]);
  assert.ok(calls.at(-1).sql.includes('INSERT INTO audit_logs'));
});
test('entry mapper converts pg amounts and rates to JSON numbers', () => {
  const row = { id: '1', employee_id: '2', employee_code: 'E2', employee_name: 'Employee' };
  for (const key of ENTRY_FIELDS) row[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = '100';
  assert.equal(toEntry(row).netMinor, 100);
  assert.equal(toEntry(row).employeeId, 2);
});
