import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDeduction, toEngineDeduction, loadDeductions, consumeOneTimeDeductions, assertNotConsumed } from '../src/services/deductions.js';
import { computeEntry } from '../src/services/payrollEngine.js';
import { parseMoney as m } from '../src/services/money.js';

const row = { id: '7', employee_id: '3', kind: 'advance', name: 'Salary advance', amount_minor: '25000', recurring: false, enabled: true,
  applied_period_id: null, created_at: 'c', updated_at: 'u' };

test('4.8b-1: toDeduction maps a database row to the API shape (bigints become numbers, null stays null)', () => {
  assert.deepEqual(toDeduction(row), { id: 7, employeeId: 3, kind: 'advance', name: 'Salary advance', amountMinor: 25000, recurring: false,
    enabled: true, appliedPeriodId: null, createdAt: 'c', updatedAt: 'u' });
  assert.equal(toDeduction({ ...row, applied_period_id: '12' }).appliedPeriodId, 12);
});

test('4.8b-1: toEngineDeduction returns exactly the four keys computeEntry reads', () => {
  const d = toEngineDeduction(toDeduction(row));
  assert.deepEqual(d, { kind: 'advance', label: 'Salary advance', amountMinor: 25000, sourceId: 7 });
});

test('4.8b-1: a mapped item goes straight into computeEntry and lands in otherDeductions and the breakdown', () => {
  const settings = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 0, companyPensionRate: 0, roundingMode: 'half_up' };
  const brackets = [{ fromMinor: 0, toMinor: null, rate: 0, fixedDeductionMinor: 0 }];
  const profile = { basicMinor: m('1000'), allowanceMinor: 0, allowanceTaxable: false, allowancePensionable: false, pensionApplies: false };
  const r = computeEntry({ settings, brackets, profile, deductions: [toEngineDeduction(toDeduction(row))] });
  assert.equal(r.otherDeductionsMinor, 25000);
  assert.equal(r.netMinor, m('1000') - 25000);
  const item = r.items.find((i) => i.sourceId === 7);
  assert.equal(item.kind, 'advance');
  assert.equal(item.label, 'Salary advance');
});

// ---- 4.8b-2: loadDeductions, with a fake client (the real-database tests are 4.8b-6)
const fakeDb = (rows) => { const calls = []; return { calls, query: async (text, params) => { calls.push({ text, params }); return { rows }; } }; };
const sqlOf = (db) => db.calls[0].text.replace(/\s+/g, ' ');

test('4.8b-2: loadDeductions returns engine-shaped items for the employee, in the order the database gave them', async () => {
  const db = fakeDb([row, { ...row, id: '8', kind: 'loan', name: 'Loan', amount_minor: '10000', recurring: true }]);
  const out = await loadDeductions(db, 3);
  assert.deepEqual(out, [
    { kind: 'advance', label: 'Salary advance', amountMinor: 25000, sourceId: 7 },
    { kind: 'loan', label: 'Loan', amountMinor: 10000, sourceId: 8 },
  ]);
  assert.deepEqual(db.calls[0].params, [3]);
});

test('4.8b-2: the query keeps enabled items only, and one-time items only while unconsumed', async () => {
  const db = fakeDb([]);
  assert.deepEqual(await loadDeductions(db, 3), []);
  const sql = sqlOf(db);
  assert.match(sql, /WHERE employee_id = \$1 AND enabled AND \(recurring OR applied_period_id IS NULL\) ORDER BY id$/);
});

test('4.8b-2: FOR UPDATE is added only when lock is true', async () => {
  const plain = fakeDb([]), locked = fakeDb([]);
  await loadDeductions(plain, 3);
  await loadDeductions(plain, 3, { lock: false });
  await loadDeductions(locked, 3, { lock: true });
  assert.ok(!sqlOf(plain).includes('FOR UPDATE'));
  assert.ok(sqlOf(locked).endsWith('ORDER BY id FOR UPDATE'));
});

// ---- 4.8b-3: consumeOneTimeDeductions, with a fake client (real-database coverage is 4.8b-6)
const countDb = (rowCount) => { const calls = []; return { calls, query: async (text, params) => { calls.push({ text, params }); return { rowCount, rows: [] }; } }; };

test('4.8b-3: consumeOneTimeDeductions updates only unconsumed one-time rows and returns the count', async () => {
  const db = countDb(2);
  assert.equal(await consumeOneTimeDeductions(db, 5, [7, 8]), 2);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [5, [7, 8]]);
  const sql = db.calls[0].text.replace(/\s+/g, ' ');
  assert.match(sql, /^UPDATE deduction_items SET applied_period_id = \$1 WHERE id = ANY\(\$2::bigint\[\]\) AND NOT recurring AND applied_period_id IS NULL$/);
});

test('4.8b-3: an empty list does nothing (no query)', async () => {
  const db = countDb(0);
  assert.equal(await consumeOneTimeDeductions(db, 5, []), 0);
  assert.equal(db.calls.length, 0);
});

test('4.8b-3: fewer updated rows than ids (consumed, recurring, unknown or duplicated id) throws 409 conflict', async () => {
  await assert.rejects(() => consumeOneTimeDeductions(countDb(1), 5, [7, 8]), (e) => e.status === 409 && e.code === 'conflict');
  await assert.rejects(() => consumeOneTimeDeductions(countDb(0), 5, [7]), (e) => e.status === 409 && e.code === 'conflict');
});

test('4.8b-3: bad arguments are refused before any query', async () => {
  const db = countDb(1);
  for (const [p, ids] of [[0, [1]], [-1, [1]], ['5', [1]], [1.5, [1]], [5, 'x'], [5, [0]], [5, ['7']], [5, [1.5]], [5, [null]]]) {
    await assert.rejects(() => consumeOneTimeDeductions(db, p, ids), (e) => e.status === 500);
  }
  assert.equal(db.calls.length, 0);
});

// ---- 4.8b-4/5: assertNotConsumed, used by PATCH and DELETE (route behaviour is covered by the DB tests in 4.8b-7)
test('4.8b-4: assertNotConsumed passes an unconsumed item and refuses a consumed one with 409 conflict', () => {
  assert.doesNotThrow(() => assertNotConsumed(toDeduction(row)));
  assert.throws(() => assertNotConsumed(toDeduction({ ...row, applied_period_id: '12' })), (e) => e.status === 409 && e.code === 'conflict');
  assert.throws(() => assertNotConsumed({ appliedPeriodId: 0 }), (e) => e.status === 409);
});
