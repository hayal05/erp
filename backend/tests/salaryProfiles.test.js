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
const URL = '/api/salary-profiles';
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
beforeEach(async () => { loginLimits.ip.clear(); loginLimits.pair.clear(); if (!skip) await query('TRUNCATE payroll_periods, deduction_items, salary_profiles RESTART IDENTITY CASCADE'); });
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });


test('salary profiles: employee isolation and lock enforcement', { skip }, async () => {
  const emp = await signIn(app, EMP);
  assert.equal((await emp.get(`${URL}/${otherId}`)).status, 403);
  assert.equal((await emp.put(`${URL}/${otherId}`).send({})).status, 403);
  const hr = await signIn(app, HR);
  await hr.post('/api/qr/lock').send({});
  assert.equal((await hr.get(`${URL}/${empId}`)).status, 423);
  assert.equal((await hr.put(`${URL}/${empId}`).send({})).status, 423);
});
test('salary profiles: save, reopen, edit, no-op audit and employee separation', { skip }, async () => {
  const hr = await signIn(app, HR), path = `${URL}/${empId}`;
  assert.equal((await hr.get(path)).body.saved, false);
  const data = { basicMinor: 250050, allowanceMinor: 12000, allowanceTaxable: false, allowancePensionable: true, pensionApplies: false };
  assert.equal((await hr.put(path).send({ ...data, employeeId: otherId })).status, 200);
  assert.deepEqual((await hr.get(path)).body, { ...data, employeeId: empId, saved: true });
  assert.equal((await hr.get(`${URL}/${otherId}`)).body.saved, false);
  await hr.put(path).send(data);
  assert.equal(await audits('payroll.profile.create'), 1);
  assert.equal(await audits('payroll.profile.update'), 0);
  await hr.put(path).send({ ...data, basicMinor: 300000 });
  assert.equal((await hr.get(path)).body.basicMinor, 300000);
  assert.equal(await audits('payroll.profile.update'), 1);
});
test('salary profiles: invalid input and missing employee save nothing', { skip }, async () => {
  const hr = await signIn(app, HR);
  assert.equal((await hr.put(`${URL}/${empId}`).send({ basicMinor: -1, allowanceMinor: 0 })).status, 400);
  assert.equal((await hr.get(`${URL}/999999`)).status, 404);
  assert.equal((await hr.put(`${URL}/999999`).send({ basicMinor: 0, allowanceMinor: 0 })).status, 404);
  assert.equal((await query('SELECT count(*)::int n FROM salary_profiles')).rows[0].n, 0);
});
