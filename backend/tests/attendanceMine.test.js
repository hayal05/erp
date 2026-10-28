// Task 2.19: GET /api/attendance/mine (an employee's own history) and the HH:MM fields of the scan confirmation. Needs Postgres.
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
const OTHER = { email: 'other@natra.test', password: 'other-password-123' };
let empId, otherId;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [shift] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  const ids = [];
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee', 'E-1'], [OTHER, 'Olu Other', 'employee', 'E-2']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.email, name, await hashPassword(c.password), role]);
    if (code) ids.push((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3) RETURNING id`, [code, u.id, shift.id])).rows[0].id);
  }
  [empId, otherId] = ids;
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear();
  if (!skip) await query('DELETE FROM attendance_records');
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

// 06:10Z = 09:10 in Addis Ababa (UTC+3), so the local time shown must differ from the UTC clock.
const add = (employeeId, date, status, inAt, outAt, late = 0) => query(
  `INSERT INTO attendance_records (employee_id, work_date, check_in_at, check_out_at, status, late_minutes, check_in_photo_id)
   VALUES ($1,$2,$3,$4,$5,$6,'natra/selfies/2026/secretphotoidsecretph')`, [employeeId, date, inAt, outAt, status, late]);

test('anonymous gets 401 and HR gets 403', { skip }, async () => {
  const anon = await (await import('supertest')).default(app).get('/api/attendance/mine');
  assert.equal(anon.status, 401);
  const hr = await signIn(app, HR);
  assert.equal((await hr.get('/api/attendance/mine')).status, 403);
});

test('an employee sees only their own records, newest first, in company-timezone HH:MM, with no photo ids', { skip }, async () => {
  await add(empId, '2026-10-26', 'present', '2026-10-26T06:00:00Z', '2026-10-26T14:05:00Z');
  await add(empId, '2026-10-27', 'late', '2026-10-27T06:10:00Z', null, 10);
  await add(otherId, '2026-10-27', 'present', '2026-10-27T05:59:00Z', null);
  const emp = await signIn(app, EMP);
  const res = await emp.get('/api/attendance/mine');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.items.map((i) => i.workDate), ['2026-10-27', '2026-10-26']);
  assert.deepEqual(res.body.items[0], { id: res.body.items[0].id, workDate: '2026-10-27', checkInTime: '09:10', checkOutTime: null, status: 'late', lateMinutes: 10, corrected: false });
  assert.equal(res.body.items[1].checkOutTime, '17:05');
  assert.doesNotMatch(JSON.stringify(res.body), /natra\/selfies|photo|reason|employeeId|fullName/i);
});

test('another employee cannot be requested: employeeId and similar parameters are ignored', { skip }, async () => {
  await add(otherId, '2026-10-27', 'present', '2026-10-27T06:00:00Z', null);
  const emp = await signIn(app, EMP);
  for (const qs of [`?employeeId=${otherId}`, `?employee_id=${otherId}`, `?userId=1`]) {
    const res = await emp.get('/api/attendance/mine' + qs);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
  }
});

test('date filters are inclusive, pagination works, bad input is 400', { skip }, async () => {
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) await add(empId, d, 'present', `${d}T06:00:00Z`, null);
  const emp = await signIn(app, EMP);
  const range = await emp.get('/api/attendance/mine?from=2026-10-21&to=2026-10-22');
  assert.deepEqual(range.body.items.map((i) => i.workDate), ['2026-10-22', '2026-10-21']);
  assert.equal(range.body.total, 2);
  const p2 = await emp.get('/api/attendance/mine?pageSize=3&page=2');
  assert.equal(p2.body.items.length, 1);
  assert.equal(p2.body.total, 4);
  const bad = await emp.get('/api/attendance/mine?from=2026-10-23&to=2026-10-20');
  assert.equal(bad.status, 400);
  assert.deepEqual(fieldsOf(bad), ['to']);
  assert.equal((await emp.get('/api/attendance/mine?from=x')).status, 400);
  assert.equal((await emp.get("/api/attendance/mine?pageSize=101")).status, 400);
});

test('a corrected row only says corrected: true (no reason, no name)', { skip }, async () => {
  await add(empId, '2026-10-27', 'present', '2026-10-27T06:00:00Z', null);
  await query(`UPDATE attendance_records SET corrected_at = now(), corrected_by_user_id = (SELECT id FROM users WHERE role='hr'), correction_reason = 'private hr note'`);
  const res = await (await signIn(app, EMP)).get('/api/attendance/mine');
  assert.equal(res.body.items[0].corrected, true);
  assert.doesNotMatch(JSON.stringify(res.body), /private hr note|Hana/);
});
