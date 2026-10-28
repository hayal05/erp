// Task 4.8a: deduction items CRUD API; 4.8b: load/consume rules (4.8b-6) and the consumed-item 409s (4.8b-7). Needs Postgres
// (skipped without TEST_DATABASE_URL).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query, withTransaction } = await import('../src/db/pool.js');
const { loadDeductions, consumeOneTimeDeductions } = await import('../src/services/deductions.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');
const { hashPassword } = await import('../src/services/password.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
const URL = '/api/deductions';
let empId, otherId;
const audits = async (action) => (await query('SELECT count(*)::int AS n FROM audit_logs WHERE action = $1', [action])).rows[0].n;
const NEW = (extra = {}) => ({ employeeId: empId, kind: 'advance', name: 'Salary advance', amountMinor: 50000, ...extra });

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [s] } = await query(`INSERT INTO shifts (name, start_time, end_time, work_days) VALUES ('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id`);
  const ids = [];
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee', 'E-1'], [{ email: 'two@natra.test', password: 'two-password-123' }, 'Two Employee', 'employee', 'E-2']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [c.email, name, await hashPassword(c.password), role]);
    if (code) ids.push((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3) RETURNING id`, [code, u.id, s.id])).rows[0].id);
  }
  [empId, otherId] = ids.map(Number);
});
beforeEach(async () => { loginLimits.ip.clear(); loginLimits.pair.clear(); if (!skip) await query('TRUNCATE payroll_periods, deduction_items RESTART IDENTITY CASCADE'); });
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

test('deductions: only HR can list or change items', { skip }, async () => {
  const request = (await import('supertest')).default;
  const emp = await signIn(app, EMP);
  assert.equal((await request(app).get(`${URL}?employeeId=${empId}`)).status, 401);
  assert.equal((await emp.get(`${URL}?employeeId=${empId}`)).status, 403);
  assert.equal((await emp.post(URL).send(NEW())).status, 403);
  assert.equal((await emp.patch(`${URL}/1`).send({ amountMinor: 1 })).status, 403);
  assert.equal((await emp.delete(`${URL}/1`)).status, 403);
  assert.equal((await query('SELECT count(*)::int AS n FROM deduction_items')).rows[0].n, 0);
});

test('deductions: create, list per employee, edit, disable and delete round-trip and are audited', { skip }, async () => {
  const hr = await signIn(app, HR);
  assert.deepEqual((await hr.get(`${URL}?employeeId=${empId}`)).body, { items: [] });

  const a = await hr.post(URL).send(NEW());
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual({ ...a.body, id: undefined, createdAt: undefined, updatedAt: undefined },
    { id: undefined, employeeId: empId, kind: 'advance', name: 'Salary advance', amountMinor: 50000, recurring: false, enabled: true, appliedPeriodId: null, createdAt: undefined, updatedAt: undefined });
  const b = (await hr.post(URL).send(NEW({ kind: 'loan', name: 'Bike loan', amountMinor: 120000, recurring: true }))).body;
  await hr.post(URL).send(NEW({ employeeId: otherId, name: 'Someone else' }));
  const list = (await hr.get(`${URL}?employeeId=${empId}`)).body.items;
  assert.deepEqual(list.map((i) => i.name), ['Salary advance', 'Bike loan']); // only this employee's, oldest first
  assert.equal(list[1].recurring, true);

  const upd = await hr.patch(`${URL}/${a.body.id}`).send({ amountMinor: 60000, name: 'Advance (Nov)', enabled: false });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.amountMinor, 60000);
  assert.equal(upd.body.enabled, false);
  const { rows: [log] } = await query(`SELECT details, entity_id FROM audit_logs WHERE action = 'payroll.deduction.update' ORDER BY id DESC LIMIT 1`);
  assert.equal(log.entity_id, String(a.body.id));
  assert.deepEqual(log.details.changes, { amountMinor: { from: 50000, to: 60000 }, name: { from: 'Salary advance', to: 'Advance (Nov)' }, enabled: { from: true, to: false } });

  assert.equal((await hr.delete(`${URL}/${b.id}`)).status, 204);
  assert.deepEqual((await hr.get(`${URL}?employeeId=${empId}`)).body.items.map((i) => i.id), [a.body.id]);
  assert.equal(await audits('payroll.deduction.create'), 3);
  const { rows: [del] } = await query(`SELECT details FROM audit_logs WHERE action = 'payroll.deduction.delete'`);
  assert.deepEqual(del.details, { employeeId: empId, kind: 'loan', name: 'Bike loan', amountMinor: 120000, recurring: true, enabled: true });
});

test('deductions: bad input is 400 with field names and saves nothing', { skip }, async () => {
  const hr = await signIn(app, HR);
  for (const [body, field] of [
    [NEW({ amountMinor: 0 }), 'amountMinor'], [NEW({ amountMinor: -5 }), 'amountMinor'], [NEW({ amountMinor: 10.5 }), 'amountMinor'], [NEW({ amountMinor: '100' }), 'amountMinor'],
    [NEW({ amountMinor: 10_000_000_000_000 }), 'amountMinor'], [NEW({ kind: 'absence' }), 'kind'], [NEW({ kind: 'bonus' }), 'kind'],
    [NEW({ name: '   ' }), 'name'], [NEW({ recurring: 'yes' }), 'recurring'], [NEW({ employeeId: 'x' }), 'employeeId'],
  ]) {
    const res = await hr.post(URL).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(errorCode(res), 'validation');
    assert.deepEqual(fieldsOf(res), [field]);
  }
  assert.deepEqual(fieldsOf(await hr.post(URL).send({})), ['amountMinor', 'employeeId', 'kind', 'name']);
  const unknown = await hr.post(URL).send(NEW({ employeeId: 999999 }));
  assert.equal(unknown.status, 400);
  assert.deepEqual(fieldsOf(unknown), ['employeeId']);
  assert.equal((await query('SELECT count(*)::int AS n FROM deduction_items')).rows[0].n, 0);

  const ok = (await hr.post(URL).send(NEW())).body;
  const res = await hr.patch(`${URL}/${ok.id}`).send({ amountMinor: -1, name: 'Changed' });
  assert.equal(res.status, 400);
  assert.deepEqual(fieldsOf(res), ['amountMinor']);
  assert.equal((await hr.patch(`${URL}/${ok.id}`).send({ kind: 'unpaid_leave' })).status, 400);
  assert.equal((await hr.patch(`${URL}/${ok.id}`).send({})).status, 400);
  assert.equal((await query('SELECT name FROM deduction_items WHERE id = $1', [ok.id])).rows[0].name, 'Salary advance'); // the valid name next to the bad amount was not saved
});

test('deductions: list needs a valid, existing employee; unknown or malformed ids are 404 / 400', { skip }, async () => {
  const hr = await signIn(app, HR);
  assert.equal((await hr.get(URL)).status, 400);
  assert.equal((await hr.get(`${URL}?employeeId=abc`)).status, 400);
  assert.equal((await hr.get(`${URL}?employeeId=999999`)).status, 404);
  assert.equal((await hr.patch(`${URL}/999999`).send({ enabled: false })).status, 404);
  assert.equal((await hr.delete(`${URL}/999999`)).status, 404);
  assert.equal((await hr.patch(`${URL}/abc`).send({ enabled: false })).status, 400);
  assert.equal((await hr.delete(`${URL}/0`)).status, 400);
});

test('deductions: a no-op PATCH writes no audit row; mass assignment is ignored; the employee cannot be changed', { skip }, async () => {
  const hr = await signIn(app, HR);
  const item = (await hr.post(URL).send(NEW())).body;
  const n0 = await audits('payroll.deduction.update');
  const same = await hr.patch(`${URL}/${item.id}`).send({ kind: 'advance', name: 'Salary advance', amountMinor: 50000, recurring: false, enabled: true });
  assert.equal(same.status, 200);
  assert.deepEqual(same.body, item); // not even updatedAt moved: nothing was written
  assert.equal(await audits('payroll.deduction.update'), n0);

  const res = await hr.patch(`${URL}/${item.id}`).send({ amountMinor: 70000, employeeId: otherId, id: 12345, appliedPeriodId: 1, createdAt: '2000-01-01' });
  assert.equal(res.status, 200);
  assert.deepEqual({ ...res.body, amountMinor: 0, updatedAt: 0 }, { ...item, amountMinor: 0, updatedAt: 0 });
  assert.equal(res.body.amountMinor, 70000);
  assert.equal(res.body.employeeId, empId);
  assert.equal(await audits('payroll.deduction.update'), n0 + 1);
});

test('deductions: an item can be switched between one-time and recurring and back, and paused', { skip }, async () => {
  const hr = await signIn(app, HR);
  const item = (await hr.post(URL).send(NEW({ recurring: true }))).body;
  assert.equal((await hr.patch(`${URL}/${item.id}`).send({ recurring: false })).body.recurring, false);
  assert.equal((await hr.patch(`${URL}/${item.id}`).send({ recurring: true, enabled: false })).body.enabled, false);
  assert.equal((await hr.get(`${URL}?employeeId=${empId}`)).body.items[0].enabled, false); // paused, not deleted
});

// ---- 4.8b-6: loadDeductions / consumeOneTimeDeductions against the real database
const mkPeriod = async (month) => Number((await query(`INSERT INTO payroll_periods (period_month) VALUES ($1) RETURNING id`, [month])).rows[0].id);
const mkItem = async (extra = {}) => {
  const i = { employeeId: empId, kind: 'advance', name: 'Item', amountMinor: 1000, recurring: false, enabled: true, ...extra };
  return Number((await query(`INSERT INTO deduction_items (employee_id, kind, name, amount_minor, recurring, enabled) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [i.employeeId, i.kind, i.name, i.amountMinor, i.recurring, i.enabled])).rows[0].id);
};
const appliedOf = async (id) => (await query('SELECT applied_period_id FROM deduction_items WHERE id = $1', [id])).rows[0].applied_period_id;

test('deductions 4.8b-6: loadDeductions returns enabled items of this employee only, oldest first, in the engine shape', { skip }, async () => {
  const a = await mkItem({ name: 'A', amountMinor: 500 });
  const b = await mkItem({ name: 'B', kind: 'loan', amountMinor: 700, recurring: true });
  await mkItem({ name: 'Paused', enabled: false });
  await mkItem({ name: 'Paused recurring', recurring: true, enabled: false });
  await mkItem({ name: 'Someone else', employeeId: otherId });
  assert.deepEqual(await loadDeductions(pool, empId), [
    { kind: 'advance', label: 'A', amountMinor: 500, sourceId: a },
    { kind: 'loan', label: 'B', amountMinor: 700, sourceId: b },
  ]);
  assert.deepEqual(await loadDeductions(pool, 999999), []);
});

test('deductions 4.8b-6: a one-time item applies to one period only, a recurring item to every period', { skip }, async () => {
  const once = await mkItem({ name: 'Once' }), every = await mkItem({ name: 'Every', recurring: true });
  const [p1, p2, p3] = [await mkPeriod('2026-09-01'), await mkPeriod('2026-10-01'), await mkPeriod('2026-11-01')];
  for (const period of [p1, p2, p3]) {
    const items = await withTransaction(async (db) => {
      const found = await loadDeductions(db, empId, { lock: true });
      const oneTimeIds = found.filter((d) => d.sourceId === once).map((d) => d.sourceId);
      await consumeOneTimeDeductions(db, period, oneTimeIds);
      return found;
    });
    assert.deepEqual(items.map((d) => d.label), period === p1 ? ['Once', 'Every'] : ['Every']);
  }
  assert.equal(Number(await appliedOf(once)), p1);   // stays with the first period
  assert.equal(await appliedOf(every), null);        // recurring is never consumed
});

test('deductions 4.8b-6: consume refuses recurring, already consumed, unknown and duplicated ids and the transaction leaves nothing behind', { skip }, async () => {
  const ok = await mkItem({ name: 'Ok' }), rec = await mkItem({ name: 'Rec', recurring: true }), used = await mkItem({ name: 'Used' });
  const p1 = await mkPeriod('2026-10-01'), p2 = await mkPeriod('2026-11-01');
  await consumeOneTimeDeductions(pool, p1, [used]);
  for (const ids of [[rec], [used], [999999], [ok, ok], [ok, rec], [ok, used], [ok, 999999]]) {
    await assert.rejects(() => withTransaction((db) => consumeOneTimeDeductions(db, p2, ids)), (e) => e.status === 409 && e.code === 'conflict', JSON.stringify(ids));
    assert.equal(await appliedOf(ok), null, `ok must stay free after ${JSON.stringify(ids)}`); // rolled back with the transaction
    assert.equal(Number(await appliedOf(used)), p1);
    assert.equal(await appliedOf(rec), null);
  }
  assert.equal(await consumeOneTimeDeductions(pool, p2, []), 0);
  assert.equal(await consumeOneTimeDeductions(pool, p2, [ok]), 1);
  assert.equal(Number(await appliedOf(ok)), p2);
});

test('deductions 4.8b-6: two generations at once cannot take the same one-time item (the second waits, then does not see it)', { skip }, async () => {
  const item = await mkItem({ name: 'Race' });
  const p1 = await mkPeriod('2026-10-01');
  const a = await pool.connect(), b = await pool.connect();
  try {
    await a.query('BEGIN'); await b.query('BEGIN');
    assert.deepEqual((await loadDeductions(a, empId, { lock: true })).map((d) => d.sourceId), [item]);
    let settled = false;
    const second = loadDeductions(b, empId, { lock: true }).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(settled, false, 'the second load must wait for the first transaction');
    await consumeOneTimeDeductions(a, p1, [item]);
    await a.query('COMMIT');
    assert.deepEqual(await second, []);
    await b.query('COMMIT');
  } finally { a.release(); b.release(); }
  assert.equal(Number(await appliedOf(item)), p1);
});

// ---- 4.8b-7: a consumed one-time item can no longer be changed or deleted (HTTP)
const rowOf = async (id) => (await query('SELECT * FROM deduction_items WHERE id = $1', [id])).rows[0];
const auditTotal = async () => (await query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n;

test('deductions 4.8b-7: PATCH of a consumed item is 409 conflict, even a no-op; the row is unchanged and no audit row is written', { skip }, async () => {
  const hr = await signIn(app, HR);
  const id = await mkItem({ name: 'Used' });
  await consumeOneTimeDeductions(pool, await mkPeriod('2026-10-01'), [id]);
  const before = await rowOf(id), n0 = await auditTotal();
  for (const body of [{ amountMinor: 99999 }, { name: 'Renamed', enabled: false }, { recurring: true }, { kind: 'advance', name: 'Used', amountMinor: 1000, recurring: false, enabled: true }]) {
    const res = await hr.patch(`${URL}/${id}`).send(body);
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(errorCode(res), 'conflict');
  }
  assert.deepEqual(await rowOf(id), before); // not even updated_at moved
  assert.equal(await auditTotal(), n0);
});

test('deductions 4.8b-7: DELETE of a consumed item is 409 conflict; the row stays and no audit row is written', { skip }, async () => {
  const hr = await signIn(app, HR);
  const id = await mkItem({ name: 'Used' });
  await consumeOneTimeDeductions(pool, await mkPeriod('2026-10-01'), [id]);
  const before = await rowOf(id), n0 = await auditTotal();
  const res = await hr.delete(`${URL}/${id}`);
  assert.equal(res.status, 409);
  assert.equal(errorCode(res), 'conflict');
  assert.deepEqual(await rowOf(id), before);
  assert.equal(await auditTotal(), n0);
  assert.equal((await hr.get(`${URL}?employeeId=${empId}`)).body.items.length, 1); // still listed
});

test('deductions 4.8b-7: unconsumed items stay editable and deletable, also next to a consumed one; recurring items are never consumed', { skip }, async () => {
  const hr = await signIn(app, HR);
  const used = await mkItem({ name: 'Used' }), free = await mkItem({ name: 'Free' }), rec = await mkItem({ name: 'Rec', recurring: true });
  const p = await mkPeriod('2026-10-01');
  await consumeOneTimeDeductions(pool, p, [used]);
  assert.equal((await hr.patch(`${URL}/${free}`).send({ amountMinor: 2500 })).body.amountMinor, 2500);
  assert.equal((await hr.patch(`${URL}/${rec}`).send({ enabled: false })).status, 200);
  assert.equal((await hr.patch(`${URL}/${rec}`).send({ enabled: true })).status, 200);
  assert.equal((await hr.delete(`${URL}/${free}`)).status, 204);
  assert.equal((await hr.delete(`${URL}/${rec}`)).status, 204);
  assert.equal(Number((await rowOf(used)).applied_period_id), p); // the consumed one is untouched
  assert.equal((await hr.patch(`${URL}/${used}`).send({ amountMinor: 1 })).status, 409);
});

// ---- 4.8b-8: deleting a draft payroll period frees its one-time items; an approved period keeps them
test('deductions 4.8b-8: deleting a draft period frees its items (load and edit work again); an item consumed by an approved period stays consumed', { skip }, async () => {
  const hr = await signIn(app, HR);
  const hrId = (await query('SELECT id FROM users WHERE email = $1', [HR.email])).rows[0].id;
  const draftItem = await mkItem({ name: 'Draft use' }), keptItem = await mkItem({ name: 'Approved use' });
  const draft = await mkPeriod('2026-09-01'), approved = await mkPeriod('2026-10-01');
  await consumeOneTimeDeductions(pool, draft, [draftItem]);
  await consumeOneTimeDeductions(pool, approved, [keptItem]);
  await query(`UPDATE payroll_periods SET status = 'approved', approved_at = now(), approved_by_user_id = $2, config_snapshot = '{}' WHERE id = $1`, [approved, hrId]);

  assert.deepEqual(await loadDeductions(pool, empId), []); // both consumed: nothing left to deduct
  assert.equal((await hr.patch(`${URL}/${draftItem}`).send({ amountMinor: 5 })).status, 409);

  await query('DELETE FROM payroll_periods WHERE id = $1', [draft]); // ON DELETE SET NULL frees it
  assert.equal(await appliedOf(draftItem), null);
  assert.deepEqual((await loadDeductions(pool, empId)).map((d) => d.sourceId), [draftItem]);
  assert.equal((await hr.patch(`${URL}/${draftItem}`).send({ amountMinor: 5 })).status, 200);

  await assert.rejects(() => query('DELETE FROM payroll_periods WHERE id = $1', [approved]), /cannot be deleted/); // the guard trigger refuses
  assert.equal(Number(await appliedOf(keptItem)), approved);
  assert.equal((await hr.delete(`${URL}/${keptItem}`)).status, 409);
  assert.equal((await hr.delete(`${URL}/${draftItem}`)).status, 204);
});
