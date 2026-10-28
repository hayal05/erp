// Task 4.5: income tax bracket API. Needs Postgres (skipped without TEST_DATABASE_URL).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');
const { hashPassword } = await import('../src/services/password.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
const TABLE = [
  { fromMinor: 0, toMinor: 60000, rate: 0, fixedDeductionMinor: 0 },
  { fromMinor: 60000, toMinor: 200000, rate: 10, fixedDeductionMinor: 6000 },
  { fromMinor: 200000, toMinor: null, rate: 15, fixedDeductionMinor: 15000 },
];

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [s] } = await query(`INSERT INTO shifts (name, start_time, end_time, work_days) VALUES ('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id`);
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee', 'E-1']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [c.email, name, await hashPassword(c.password), role]);
    if (code) await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3)`, [code, u.id, s.id]);
  }
});
beforeEach(async () => { loginLimits.ip.clear(); loginLimits.pair.clear(); if (!skip) await query('DELETE FROM income_tax_brackets'); });
after(async () => { if (!skip) { await query(TRUNCATE_ALL); await resetSettings(); } await pool.end(); }); // settings is a seed row TRUNCATE_ALL keeps: restore it so later files (schema.test.js) see the spec defaults

test('only HR can read or change brackets', { skip }, async () => {
  const request = (await import('supertest')).default;
  const emp = await signIn(app, EMP);
  assert.equal((await request(app).get('/api/payroll-settings/brackets')).status, 401);
  assert.equal((await emp.get('/api/payroll-settings/brackets')).status, 403);
  assert.equal((await emp.put('/api/payroll-settings/brackets').send({ items: TABLE })).status, 403);
});

test('an empty table reports a problem; a valid PUT replaces the table and is audited', { skip }, async () => {
  const hr = await signIn(app, HR);
  const empty = await hr.get('/api/payroll-settings/brackets');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.problems.length, 1);

  const put = await hr.put('/api/payroll-settings/brackets').send({ items: TABLE });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.problems, []);
  assert.deepEqual(put.body.items.map(({ id, ...r }) => r), TABLE);

  const replaced = await hr.put('/api/payroll-settings/brackets').send({ items: [{ fromMinor: 0, toMinor: null, rate: 7.5 }] });
  assert.equal(replaced.body.items.length, 1);
  assert.equal((await query('SELECT count(*)::int AS n FROM income_tax_brackets')).rows[0].n, 1);
  const logs = (await query(`SELECT details FROM audit_logs WHERE action = 'payroll.brackets.replace' ORDER BY id`)).rows;
  assert.equal(logs.length, 2);
  assert.equal(logs[1].details.before.length, 3);
});

test('an invalid table is refused with 400 and leaves the saved table untouched', { skip }, async () => {
  const hr = await signIn(app, HR);
  await hr.put('/api/payroll-settings/brackets').send({ items: TABLE });
  for (const bad of [
    [TABLE[0], { ...TABLE[1], toMinor: 190000 }, TABLE[2]], // gap
    [TABLE[0], { ...TABLE[1], toMinor: 210000 }, TABLE[2]], // overlap
    TABLE.slice(1),                                         // no bracket at 0
    TABLE.slice(0, 2),                                      // no open-ended bracket
  ]) {
    const res = await hr.put('/api/payroll-settings/brackets').send({ items: bad });
    assert.equal(res.status, 400);
    assert.equal(errorCode(res), 'validation');
  }
  assert.equal((await hr.get('/api/payroll-settings/brackets')).body.items.length, 3);
});

// ---- Task 4.6: pension rates and bases. The settings row is seed data, so each test resets it to the spec defaults.
const DEFAULTS = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 5, companyPensionRate: 10 };
const resetSettings = () => query(`UPDATE payroll_settings SET tax_base = 'basic', pension_base = 'basic', employee_pension_rate = 5, company_pension_rate = 10`);

test('calculation settings: only HR can read or change them', { skip }, async () => {
  const request = (await import('supertest')).default;
  const emp = await signIn(app, EMP);
  assert.equal((await request(app).get('/api/payroll-settings/calculation')).status, 401);
  assert.equal((await emp.get('/api/payroll-settings/calculation')).status, 403);
  assert.equal((await emp.patch('/api/payroll-settings/calculation').send({ employeePensionRate: 1 })).status, 403);
});

test('calculation settings: defaults are the spec values; rates and bases persist across requests (done-when)', { skip }, async () => {
  await resetSettings();
  const hr = await signIn(app, HR);
  assert.deepEqual((await hr.get('/api/payroll-settings/calculation')).body, DEFAULTS);

  const res = await hr.patch('/api/payroll-settings/calculation')
    .send({ employeePensionRate: 7.25, companyPensionRate: 11, taxBase: 'basic_plus_taxable_allowance', pensionBase: 'basic_plus_pensionable_allowance' });
  assert.equal(res.status, 200);
  const expected = { taxBase: 'basic_plus_taxable_allowance', pensionBase: 'basic_plus_pensionable_allowance', employeePensionRate: 7.25, companyPensionRate: 11 };
  assert.deepEqual(res.body, expected);
  // A different session reads the same values from the database.
  const again = await signIn(app, HR);
  assert.deepEqual((await again.get('/api/payroll-settings/calculation')).body, expected);

  // Partial update: omitted keys keep their value, and the settings row stays a single row.
  const partial = await hr.patch('/api/payroll-settings/calculation').send({ companyPensionRate: 0 });
  assert.deepEqual(partial.body, { ...expected, companyPensionRate: 0 });
  assert.equal((await query('SELECT count(*)::int AS n FROM payroll_settings')).rows[0].n, 1);
});

test('calculation settings: the engine reads what was saved (loadSettings)', { skip }, async () => {
  await resetSettings();
  const hr = await signIn(app, HR);
  await hr.patch('/api/payroll-settings/calculation').send({ employeePensionRate: 6, taxBase: 'basic_plus_taxable_allowance' });
  const { loadSettings } = await import('../src/routes/payrollSettings.js');
  assert.deepEqual(await loadSettings({ query }), { taxBase: 'basic_plus_taxable_allowance', pensionBase: 'basic', employeePensionRate: 6, companyPensionRate: 10, roundingMode: 'half_up', absenceDeductionEnabled: false, unpaidLeaveDeductionEnabled: false });
});

test('calculation settings: bad input is 400 with field names and changes nothing', { skip }, async () => {
  await resetSettings();
  const hr = await signIn(app, HR);
  for (const [body, field] of [
    [{ employeePensionRate: 101 }, 'employeePensionRate'], [{ companyPensionRate: -1 }, 'companyPensionRate'],
    [{ employeePensionRate: 5.00001 }, 'employeePensionRate'], [{ employeePensionRate: '5' }, 'employeePensionRate'],
    [{ taxBase: 'gross' }, 'taxBase'], [{ pensionBase: 'everything' }, 'pensionBase'], [{}, '_'],
  ]) {
    const res = await hr.patch('/api/payroll-settings/calculation').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(errorCode(res), 'validation');
    assert.deepEqual(fieldsOf(res), [field]);
  }
  // A valid field next to an invalid one saves neither.
  const mixed = await hr.patch('/api/payroll-settings/calculation').send({ companyPensionRate: 12, taxBase: 'gross' });
  assert.equal(mixed.status, 400);
  assert.deepEqual((await hr.get('/api/payroll-settings/calculation')).body, DEFAULTS);
});

test('calculation settings: changes are audited with before/after; a no-op writes nothing; mass assignment is ignored', { skip }, async () => {
  await resetSettings();
  const hr = await signIn(app, HR);
  const count = async () => (await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'payroll.settings.update'`)).rows[0].n;
  const n0 = await count();

  await hr.patch('/api/payroll-settings/calculation').send({ employeePensionRate: 8, pensionBase: 'basic_plus_pensionable_allowance' });
  assert.equal(await count(), n0 + 1);
  const { rows: [log] } = await query(`SELECT details FROM audit_logs WHERE action = 'payroll.settings.update' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual(log.details.changes, { employeePensionRate: { from: 5, to: 8 }, pensionBase: { from: 'basic', to: 'basic_plus_pensionable_allowance' } });

  // Same values again: 200, nothing changes, no new audit row.
  const same = await hr.patch('/api/payroll-settings/calculation').send({ employeePensionRate: 8 });
  assert.equal(same.status, 200);
  assert.equal(await count(), n0 + 1);

  // Columns that are not part of this API (rounding mode, deduction switches) cannot be set through it.
  await hr.patch('/api/payroll-settings/calculation').send({ companyPensionRate: 9, roundingMode: 'down', absenceDeductionEnabled: true });
  const { rows: [row] } = await query('SELECT rounding_mode, absence_deduction_enabled FROM payroll_settings');
  assert.deepEqual(row, { rounding_mode: 'half_up', absence_deduction_enabled: false });
});

// ---- Task 4.7: other taxes (predefined bases only)
const TAXES = '/api/payroll-settings/other-taxes';
const taxAudit = async (action) => (await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1`, [action])).rows[0].n;

test('other taxes: only HR can list or change them', { skip }, async () => {
  const request = (await import('supertest')).default;
  const emp = await signIn(app, EMP);
  assert.equal((await request(app).get(TAXES)).status, 401);
  assert.equal((await emp.get(TAXES)).status, 403);
  assert.equal((await emp.post(TAXES).send({ name: 'X', rate: 1, base: 'gross' })).status, 403);
  assert.equal((await emp.patch(`${TAXES}/1`).send({ rate: 2 })).status, 403);
  assert.equal((await emp.delete(`${TAXES}/1`)).status, 403);
});

test('other taxes: create, list (with the fixed base list), update and delete round-trip and are audited', { skip }, async () => {
  await query('DELETE FROM other_taxes');
  const hr = await signIn(app, HR);
  const empty = await hr.get(TAXES);
  assert.deepEqual(empty.body.items, []);
  assert.deepEqual(empty.body.bases, ['gross', 'basic', 'taxable_income', 'pensionable']);

  const created = await hr.post(TAXES).send({ name: 'Stamp duty', rate: 0.75, base: 'gross' });
  assert.equal(created.status, 201);
  assert.deepEqual({ ...created.body, id: undefined }, { id: undefined, name: 'Stamp duty', rate: 0.75, base: 'gross', enabled: true });
  const id = created.body.id;
  await hr.post(TAXES).send({ name: 'Levy', rate: 2, base: 'taxable_income', enabled: false });
  assert.deepEqual((await hr.get(TAXES)).body.items.map((t) => t.name), ['Levy', 'Stamp duty']); // by name

  const upd = await hr.patch(`${TAXES}/${id}`).send({ rate: 1.25, base: 'basic', enabled: false });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.body, { id, name: 'Stamp duty', rate: 1.25, base: 'basic', enabled: false });
  const { rows: [log] } = await query(`SELECT details FROM audit_logs WHERE action = 'payroll.other_tax.update' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual(log.details.changes, { rate: { from: 0.75, to: 1.25 }, base: { from: 'gross', to: 'basic' }, enabled: { from: true, to: false } });

  assert.equal((await hr.delete(`${TAXES}/${id}`)).status, 204);
  assert.equal((await hr.get(TAXES)).body.items.length, 1);
  assert.ok(await taxAudit('payroll.other_tax.create') >= 2);
  assert.ok(await taxAudit('payroll.other_tax.delete') >= 1);
});

test('other taxes: an unknown base is rejected on create and update and nothing is saved (done-when)', { skip }, async () => {
  await query('DELETE FROM other_taxes');
  const hr = await signIn(app, HR);
  for (const base of ['everything', 'net', 'gross * 2', 'GROSS', 5, null]) {
    const res = await hr.post(TAXES).send({ name: 'Bad', rate: 1, base });
    assert.equal(res.status, 400, String(base));
    assert.equal(errorCode(res), 'validation');
    assert.deepEqual(fieldsOf(res), ['base']);
  }
  assert.equal((await query('SELECT count(*)::int AS n FROM other_taxes')).rows[0].n, 0);
  const ok = (await hr.post(TAXES).send({ name: 'Fine', rate: 1, base: 'pensionable' })).body;
  const res = await hr.patch(`${TAXES}/${ok.id}`).send({ base: 'formula', rate: 9 });
  assert.equal(res.status, 400);
  assert.deepEqual(fieldsOf(res), ['base']);
  assert.deepEqual((await hr.get(TAXES)).body.items, [ok]); // the valid rate next to the bad base was not saved either
});

test('other taxes: bad rate / name / body is 400 with field names; duplicate name (any case) is 409 on name', { skip }, async () => {
  await query('DELETE FROM other_taxes');
  const hr = await signIn(app, HR);
  for (const [body, field] of [
    [{ name: 'X', rate: 101, base: 'gross' }, 'rate'], [{ name: 'X', rate: -1, base: 'gross' }, 'rate'], [{ name: 'X', rate: 1.00001, base: 'gross' }, 'rate'],
    [{ name: 'X', rate: '5', base: 'gross' }, 'rate'], [{ name: '   ', rate: 1, base: 'gross' }, 'name'], [{ name: 'X', rate: 1, base: 'gross', enabled: 'yes' }, 'enabled'],
  ]) {
    const res = await hr.post(TAXES).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(fieldsOf(res), [field]);
  }
  assert.deepEqual(fieldsOf(await hr.post(TAXES).send({})), ['base', 'name', 'rate']);

  const a = (await hr.post(TAXES).send({ name: 'Stamp duty', rate: 1, base: 'gross' })).body;
  const b = (await hr.post(TAXES).send({ name: 'Levy', rate: 1, base: 'gross' })).body;
  const dup = await hr.post(TAXES).send({ name: 'STAMP DUTY', rate: 2, base: 'basic' });
  assert.equal(dup.status, 409);
  assert.deepEqual(fieldsOf(dup), ['name']);
  const rename = await hr.patch(`${TAXES}/${b.id}`).send({ name: 'stamp duty' });
  assert.equal(rename.status, 409);
  assert.deepEqual(fieldsOf(rename), ['name']);
  assert.equal((await hr.patch(`${TAXES}/${a.id}`).send({ name: 'STAMP DUTY' })).status, 200); // renaming to itself in another case is fine
  assert.equal((await hr.patch(`${TAXES}/${a.id}`).send({})).status, 400);
});

test('other taxes: unknown or malformed id is 404 / 400; a no-op update writes no audit row; mass assignment is ignored', { skip }, async () => {
  await query('DELETE FROM other_taxes');
  const hr = await signIn(app, HR);
  assert.equal((await hr.patch(`${TAXES}/999999`).send({ rate: 1 })).status, 404);
  assert.equal((await hr.delete(`${TAXES}/999999`)).status, 404);
  assert.equal((await hr.patch(`${TAXES}/abc`).send({ rate: 1 })).status, 400);
  assert.equal((await hr.delete(`${TAXES}/0`)).status, 400);

  const t = (await hr.post(TAXES).send({ name: 'Levy', rate: 2, base: 'basic' })).body;
  const n0 = await taxAudit('payroll.other_tax.update');
  const same = await hr.patch(`${TAXES}/${t.id}`).send({ rate: 2, base: 'basic', name: 'Levy' });
  assert.equal(same.status, 200);
  assert.deepEqual(same.body, t);
  assert.equal(await taxAudit('payroll.other_tax.update'), n0);
  const res = await hr.patch(`${TAXES}/${t.id}`).send({ rate: 3, id: 12345, createdAt: '2000-01-01' });
  assert.deepEqual(res.body, { ...t, rate: 3 });
});

test('other taxes: loadOtherTaxes feeds the engine; the Other Tax column is the sum, disabled taxes add nothing', { skip }, async () => {
  await query('DELETE FROM other_taxes');
  const hr = await signIn(app, HR);
  await hr.post(TAXES).send({ name: 'On gross', rate: 1, base: 'gross' });
  await hr.post(TAXES).send({ name: 'On basic', rate: 2.5, base: 'basic' });
  await hr.post(TAXES).send({ name: 'Paused', rate: 50, base: 'gross', enabled: false });
  const { loadOtherTaxes } = await import('../src/routes/payrollSettings.js');
  const { computeEntry } = await import('../src/services/payrollEngine.js');
  const otherTaxes = await loadOtherTaxes({ query });
  assert.equal(otherTaxes.length, 3);
  const e = computeEntry({
    settings: { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 5, companyPensionRate: 10, roundingMode: 'half_up' },
    brackets: [{ fromMinor: 0, toMinor: null, rate: 0, fixedDeductionMinor: 0 }],
    profile: { basicMinor: 1000000, allowanceMinor: 200000, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true },
    otherTaxes,
  });
  assert.equal(e.otherTaxMinor, 37000);
});
