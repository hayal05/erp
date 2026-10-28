import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayment } from '../src/services/payrollPayment.js';
import { markPeriodPaid } from '../src/services/payrollWorkflow.js';
test('payment requires a real date and ignores client status/actor fields', () => {
  assert.deepEqual(parsePayment({ paidOn: '2028-02-29', status: 'draft', paidByUserId: 999 }).value, { paidOn: '2028-02-29' });
  for (const paidOn of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '0000-01-01', '2026-10-28T00:00:00Z', '', null, 123]) assert.ok(parsePayment({ paidOn }).errors, String(paidOn));
  for (const body of [{}, null, []]) assert.ok(parsePayment(body).errors);
});
function fixture(status = 'approved') {
  const calls = [];
  return { calls, db: { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT')) return { rows: status == null ? [] : [{ status, month: '2026-10' }] };
    if (sql.startsWith('UPDATE')) return { rows: [] };
    if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ id: 1 }] };
    throw new Error(sql);
  } } };
}
test('payment changes only status/payment metadata and audits the same transaction', async () => {
  const { db, calls } = fixture();
  const result = await markPeriodPaid(db, { periodId: 1, actorId: 2, paidOn: '2026-10-31' });
  assert.deepEqual(result, { id: 1, month: '2026-10', status: 'paid', paidOn: '2026-10-31', paidByUserId: 2 });
  assert.ok(calls[0].sql.includes('FOR UPDATE'));
  assert.deepEqual(calls[1].params, [1, '2026-10-31', 2]);
  assert.ok(!calls[1].sql.includes('config_snapshot'));
  assert.ok(!calls.some((c) => c.sql.includes('payroll_entries')));
  const details = JSON.parse(calls[2].params[5]);
  assert.deepEqual(details, { month: '2026-10', from: 'approved', to: 'paid', paidOn: '2026-10-31' });
  assert.equal(calls[2].params[1], 'payroll.period.pay');
});
test('draft, already paid and missing periods cannot be paid and write no audit', async () => {
  for (const [state, status] of [['draft',409], ['paid',409], [null,404]]) {
    const { db, calls } = fixture(state);
    await assert.rejects(markPeriodPaid(db, { periodId: 1, actorId: 2, paidOn: '2026-10-31' }), { status });
    assert.equal(calls.length, 1);
  }
});
