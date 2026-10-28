// Task 3.8: approved leave and holidays drive attendance (absent / on_leave rows, scan refusal).
// Pure tests always run; the DB tests need Postgres (TEST_DATABASE_URL) and were NOT run when this was written (no Postgres).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { fillWindow } = await import('../src/services/attendanceStatus.js');

// ---- pure: which dates the HR list fills
test('fillWindow: no dates = last 31 days; dates are capped to 62 days back and to today; the future is nothing to fill', () => {
  const today = '2026-10-28';
  assert.deepEqual(fillWindow({}, today), { from: '2026-09-27', to: today });
  assert.deepEqual(fillWindow({ from: '2026-10-19', to: '2026-10-20' }, today), { from: '2026-10-19', to: '2026-10-20' });
  assert.deepEqual(fillWindow({ from: '2025-01-01' }, today), { from: '2026-08-27', to: today });
  assert.deepEqual(fillWindow({ from: '2026-10-01', to: '2026-12-31' }, today), { from: '2026-10-01', to: today });
  assert.equal(fillWindow({ from: '2026-11-01', to: '2026-11-30' }, today), null);
  assert.equal(fillWindow({ from: '2026-12-01' }, today), null);
  assert.equal(fillWindow({ to: '2026-01-01' }, today), null); // entirely before the 62-day window
});

// ---- database
let query, pool, migrate, hrSignIn, hashPassword, fillAttendanceGaps, applyApprovedLeaveToAttendance, classifyForEmployee;
let shiftId, emp, other, hrUserId, annual;
const MON = '2026-10-19', TUE = '2026-10-20', WED = '2026-10-21', SAT = '2026-10-24';
const NOON_TUE = new Date('2026-10-20T12:00:00+03:00'); // shift 09:00-17:00 still open
const EVENING_TUE = new Date('2026-10-20T18:00:00+03:00'); // shift over

before(async () => {
  if (skip) return;
  ({ query, pool } = await import('../src/db/pool.js'));
  ({ migrate } = await import('../src/db/migrate.js'));
  ({ hashPassword } = await import('../src/services/password.js'));
  ({ fillAttendanceGaps, applyApprovedLeaveToAttendance, classifyForEmployee } = await import('../src/services/attendanceStatus.js'));
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  shiftId = Number((await query(`INSERT INTO shifts (name, start_time, end_time, work_days) VALUES ('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id`)).rows[0].id);
  const mk = async (email, name, role, code, start) => {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [email, name, await hashPassword('password-12345'), role]);
    if (role === 'hr') return Number(u.id);
    return Number((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,$3,$4) RETURNING id`, [code, u.id, start, shiftId])).rows[0].id);
  };
  hrUserId = await mk('hr@natra.test', 'Hana HR', 'hr');
  emp = await mk('e1@natra.test', 'Eli One', 'employee', 'E-1', '2026-01-05');
  other = await mk('e2@natra.test', 'Olu Two', 'employee', 'E-2', '2026-10-20'); // starts on the Tuesday
  annual = Number((await query(`SELECT id FROM leave_types WHERE code = 'annual'`)).rows[0].id);
});
beforeEach(async () => {
  if (skip) return;
  await query('DELETE FROM attendance_records'); await query('DELETE FROM leave_requests'); await query('DELETE FROM holidays');
  await query(`UPDATE employees SET status = 'active'`);
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); if (pool) await pool.end(); });

const rowsOf = async (employeeId) => (await query(
  `SELECT to_char(work_date,'YYYY-MM-DD') AS d, status, late_minutes FROM attendance_records WHERE employee_id = $1 ORDER BY work_date`, [employeeId])).rows;
const approve = async (employeeId, start, end, days) => Number((await query(
  `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status, decided_at)
   VALUES ($1,$2,$3,$4,$5,'seed','approved', now()) RETURNING id`, [employeeId, annual, start, end, days])).rows[0].id);

test('absent rows: working days that ended, none for days off, holidays, today before the shift end, or before the start date', { skip }, async () => {
  await query(`INSERT INTO holidays (holiday_date, name) VALUES ($1, 'Test holiday')`, [WED]);
  // Fri 16 .. Sun 25 with "now" = Tuesday 18:00: Fri, Mon, Tue (shift over) are absent; Sat/Sun days off; Wed is a holiday; Thu/Fri not yet.
  const out = await fillAttendanceGaps({ query }, { from: '2026-10-16', to: '2026-10-25', now: EVENING_TUE });
  assert.deepEqual(await rowsOf(emp), [{ d: '2026-10-16', status: 'absent', late_minutes: 0 }, { d: MON, status: 'absent', late_minutes: 0 }, { d: TUE, status: 'absent', late_minutes: 0 }]);
  assert.deepEqual((await rowsOf(other)).map((r) => r.d), [TUE]); // started on Tuesday: nothing before it
  assert.deepEqual(out, { onLeave: 0, absent: 4 });
  const again = await fillAttendanceGaps({ query }, { from: '2026-10-16', to: '2026-10-25', now: EVENING_TUE });
  assert.deepEqual(again, { onLeave: 0, absent: 0 }); // idempotent
});

test("today is not absent until the shift has ended", { skip }, async () => {
  await fillAttendanceGaps({ query }, { from: TUE, to: TUE, now: NOON_TUE });
  assert.deepEqual(await rowsOf(emp), []);
  await fillAttendanceGaps({ query }, { from: TUE, to: TUE, now: EVENING_TUE });
  assert.deepEqual((await rowsOf(emp)).map((r) => r.status), ['absent']);
});

test('existing rows are never overwritten, and inactive employees get none', { skip }, async () => {
  await query(`INSERT INTO attendance_records (employee_id, work_date, check_in_at, status, late_minutes) VALUES ($1,$2,$3,'late',12)`, [emp, MON, '2026-10-19T06:12:00Z']);
  await query(`UPDATE employees SET status = 'inactive' WHERE id = $1`, [other]);
  await fillAttendanceGaps({ query }, { from: MON, to: TUE, now: EVENING_TUE });
  assert.deepEqual(await rowsOf(emp), [{ d: MON, status: 'late', late_minutes: 12 }, { d: TUE, status: 'absent', late_minutes: 0 }]);
  assert.deepEqual(await rowsOf(other), []);
});

test('approved leave becomes on_leave rows (also for days still to come); pending, rejected and days off do not', { skip }, async () => {
  await approve(emp, MON, WED, 3); // Mon-Wed
  await query(`INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1,$2,'2026-10-26','2026-10-27',2,'x')`, [emp, annual]); // pending
  const out = await fillAttendanceGaps({ query }, { from: '2026-10-17', to: '2026-10-28', now: NOON_TUE });
  // "now" is Tuesday noon: Monday has ended, but nothing else is absent yet except days already past (none for Eli before Monday's leave).
  assert.deepEqual((await rowsOf(emp)).map((r) => `${r.d}:${r.status}`), [`${MON}:on_leave`, `${TUE}:on_leave`, `${WED}:on_leave`]);
  assert.equal(out.onLeave, 3);
  // The pending request's days are NOT on_leave: after "now" they are future days, so no row at all.
  assert.ok(!(await rowsOf(emp)).some((r) => r.d >= '2026-10-26'));
});

test('a holiday inside approved leave gets no row', { skip }, async () => {
  await approve(emp, MON, WED, 2);
  await query(`INSERT INTO holidays (holiday_date, name) VALUES ($1, 'Mid-leave holiday')`, [TUE]);
  await fillAttendanceGaps({ query }, { from: MON, to: WED, now: EVENING_TUE });
  assert.deepEqual((await rowsOf(emp)).map((r) => r.d), [MON, WED]);
});

test('approving leave converts earlier absent rows without a check-in, but keeps a row where the person did check in', { skip }, async () => {
  await fillAttendanceGaps({ query }, { from: MON, to: TUE, now: EVENING_TUE }); // both days absent
  await query(`UPDATE attendance_records SET check_in_at = '2026-10-20T06:00:00Z', status = 'present' WHERE employee_id = $1 AND work_date = $2`, [emp, TUE]);
  await approve(emp, MON, WED, 3);
  const n = await applyApprovedLeaveToAttendance({ query }, { employeeId: emp, from: MON, to: WED, now: EVENING_TUE });
  assert.equal(n, 2); // Mon converted, Wed created; Tue untouched
  assert.deepEqual((await rowsOf(emp)).map((r) => `${r.d}:${r.status}`), [`${MON}:on_leave`, `${TUE}:present`, `${WED}:on_leave`]);
});

test('a scan on a leave day is refused with 409 on_leave; on a holiday it is present with 0 late minutes', { skip }, async () => {
  await approve(emp, MON, MON, 1);
  await assert.rejects(classifyForEmployee({ query }, { employeeId: emp, workDate: MON }), (e) => e.status === 409 && e.code === 'on_leave');
  await query(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-10-26', 'Holiday')`);
  const out = await classifyForEmployee({ query }, { employeeId: other, workDate: '2026-10-26' });
  assert.deepEqual(out, { status: 'present', lateMinutes: 0 });
});

test('an on_leave row (leave approved through the API) blocks the real scan route as well', { skip }, async () => {
  // The leave API path is covered in leaveAdmin.test.js; here the on_leave row alone must refuse a scan (nextAction, task 2.13).
  const { nextAction } = await import('../src/services/attendance.js');
  await approve(emp, MON, MON, 1);
  await applyApprovedLeaveToAttendance({ query }, { employeeId: emp, from: MON, to: MON, now: EVENING_TUE });
  const { rows: [r] } = await query(`SELECT * FROM attendance_records WHERE employee_id = $1 AND work_date = $2`, [emp, MON]);
  assert.throws(() => nextAction(r), (e) => e.status === 409 && e.code === 'on_leave');
});
