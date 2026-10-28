import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvePeriod, assertEntryCurrent, snapshotItem } from '../src/services/payrollWorkflow.js';
import { computeEntry } from '../src/services/payrollEngine.js';
const settings = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 5, companyPensionRate: 10 };
const brackets = [{ fromMinor: 0, toMinor: null, rate: 15, fixedDeductionMinor: 15000 }];
const profile = { basicMinor: 250000, allowanceMinor: 10000, pensionApplies: true, allowanceTaxable: true, allowancePensionable: true };
const computed = computeEntry({ settings, brackets, profile });
const input = { periodId: 1, actorId: 3, settings, brackets, otherTaxes: [] };
function fixture({ status = 'draft', missing = false, empty = false, stale = false } = {}) {
  const calls = [], row = { id: '2', employee_id: '4', employee_code: 'E4', employee_name: 'Employee' };
  for (const [k,v] of Object.entries(computed)) if (k !== 'items') row[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = String(v);
  if (stale) row.net_minor = '1';
  return { calls, db: { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM payroll_periods')) return { rows: missing ? [] : [{ status, month: '2026-10' }] };
    if (sql.includes('FROM payroll_entries')) return { rows: empty ? [] : [row] };
    if (sql.includes('FROM salary_profiles')) return { rows: [{ employee_id: '4', basic_minor: '999', allowance_minor: '999', allowance_taxable: true, allowance_pensionable: true, pension_applies: true }] };
    if (sql.includes('FROM payroll_entry_items')) return { rows: [] };
    if (sql.includes('FROM payroll_settings')) return { rows: [{ currency_code: 'ETB', absence_deduction_enabled: false, unpaid_leave_deduction_enabled: false }] };
    if (sql.startsWith('UPDATE payroll_periods')) return { rows: [{ approved_at: '2026-10-28T12:00:00Z', approved_by_user_id: '3' }] };
    if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ id: 1 }] };
    throw new Error(`Unexpected SQL ${sql}`);
  } } };
}
test('approval snapshots reviewed entry amounts, profile flags, config and approver', async () => {
  const { db, calls } = fixture();
  const result = await approvePeriod(db, input);
  assert.equal(result.status, 'approved'); assert.equal(result.approvedByUserId, 3);
  const snap = JSON.parse(calls.find((c) => c.sql.startsWith('UPDATE')).params[1]);
  assert.equal(snap.version, 1); assert.equal(snap.settings.currencyCode, 'ETB');
  assert.deepEqual(snap.brackets, brackets);
  assert.equal(snap.entries[0].profile.basicMinor, 250000);
  assert.equal(snap.entries[0].netMinor, computed.netMinor);
  assert.equal(calls.filter((c) => /^(UPDATE|INSERT)/.test(c.sql)).length, 2);
  assert.ok(calls.at(-1).sql.includes('audit_logs'));
});
test('approval rejects locked, missing and empty periods without writes', async () => {
  for (const [options, status] of [[{ status: 'approved' },409], [{ status: 'paid' },409], [{ missing: true },404], [{ empty: true },422]]) {
    const { db, calls } = fixture(options);
    await assert.rejects(approvePeriod(db, input), { status });
    assert.ok(!calls.some((c) => /^(UPDATE|INSERT)/.test(c.sql)));
  }
});
test('approval refuses stale totals or invalid brackets before writing snapshot', async () => {
  for (const invalid of [false, true]) {
    const { db, calls } = fixture({ stale: !invalid });
    await assert.rejects(approvePeriod(db, { ...input, brackets: invalid ? [] : brackets }), { code: invalid ? 'invalid_brackets' : 'stale_payroll' });
    assert.ok(!calls.some((c) => /^(UPDATE|INSERT)/.test(c.sql)));
  }
});
test('approval compares full tax breakdown even when totals remain the same', () => {
  const tax = { kind: 'other_tax', label: 'Old name', rate: 1, baseMinor: 10000, amountMinor: 100, sourceId: 7 };
  assert.throws(() => assertEntryCurrent({ id: 2, ...computed }, [tax], { ...computed, items: [{ ...tax, label: 'New name' }] }), { code: 'stale_payroll' });
  assert.doesNotThrow(() => assertEntryCurrent(computed, [tax], { ...computed, items: [tax] }));
  assert.deepEqual(snapshotItem({ kind: 'loan', label: 'Loan', rate: null, base_minor: null, amount_minor: '100', source_id: '8' }), { kind: 'loan', label: 'Loan', rate: null, baseMinor: null, amountMinor: 100, sourceId: 8 });
});
