// Task 2.14 against a real database: the scan transaction. Needs Postgres (TEST_DATABASE_URL).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { applyScan, submitScan } = await import('../src/services/attendance.js');
const { issueQrToken } = await import('../src/services/qrToken.js');
const { classifyForEmployee } = await import('../src/services/attendanceStatus.js');
const { companyDate } = await import('../src/services/attendance.js');

const DAY = '2026-10-19';
const photo = (n) => `natra/selfies/2026/${String(n).padStart(24, 'p')}`;
let hr, session, e1, e2;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [shift] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  const mk = async (email, role) => (await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$1,'x',$2) RETURNING id`, [email, role])).rows[0];
  hr = await mk('hr@x.test', 'hr');
  await query("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[hr.id]);
  const mkEmp = async (email, code) => {
    const u = await mk(email, 'employee');
    const { rows: [e] } = await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3) RETURNING id`, [code, u.id, shift.id]);
    return { id: e.id, userId: u.id };
  };
  e1 = await mkEmp('e1@x.test', 'E-1');
  e2 = await mkEmp('e2@x.test', 'E-2');
  ({ rows: [session] } = await query(`INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ('hr-session', $1, 'c', now() + interval '1 hour') RETURNING id`, [hr.id]));
});
beforeEach(async () => { if (!skip) { await query('DELETE FROM attendance_records'); await query('DELETE FROM attendance_tokens'); await query('TRUNCATE audit_logs'); } });
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const token = async () => (await issueQrToken({ query }, { sessionId: session.id, userId: hr.id })).token;
// issueQrToken expires the session's earlier unused tokens, so several live tokens are inserted by hand.
async function extraToken(n) {
  const { hashQrToken } = await import('../src/services/qrToken.js');
  const t = `X${n}`.padEnd(43, 'x');
  await query(`INSERT INTO attendance_tokens (token_hash, issued_by_session_id, issued_by_user_id, expires_at) VALUES ($1,$2,$3, now() + interval '45 seconds')`, [hashQrToken(t), session.id, hr.id]);
  return t;
}
const scan = (e, t, n = 1, extra = {}) => applyScan({ employeeId: e.id, userId: e.userId, token: t, workDate: DAY, photoId: photo(n), ...extra });
const tokenUsed = async (t) => { const { hashQrToken } = await import('../src/services/qrToken.js'); return (await query(`SELECT used_at, used_by_employee_id FROM attendance_tokens WHERE token_hash = $1`, [hashQrToken(t)])).rows[0]; };
const count = async (table) => (await query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;

test('check-in: writes the record with the DB clock, stores the photo id, records the employee receipt, audits', { skip }, async () => {
  const t = await token();
  const out = await scan(e1, t, 1);
  assert.equal(out.action, 'check_in');
  assert.equal(out.record.status, 'present');
  assert.equal(out.record.check_in_photo_id, photo(1));
  assert.ok(Math.abs(new Date(out.record.check_in_at) - Date.now()) < 10_000);
  assert.equal((await tokenUsed(t)).used_at, null);
  assert.equal(await count('attendance_token_scans'), 1);
  assert.equal((await query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'attendance.check_in'`)).rows[0].n, 1);
});

test('second scan with another token is the check-out on the same row; a third is refused and consumes nothing', { skip }, async () => {
  await scan(e1, await token(), 1);
  const t2 = await extraToken(2);
  const out = await scan(e1, t2, 2);
  assert.equal(out.action, 'check_out');
  assert.equal(out.record.check_out_photo_id, photo(2));
  assert.equal(await count('attendance_records'), 1);
  const t3 = await extraToken(3);
  await assert.rejects(scan(e1, t3, 3), (e) => e.status === 409 && e.code === 'already_checked_out');
  assert.equal((await tokenUsed(t3)).used_at, null); // refusal rolled back: token still usable
});

test('a shared token accepts a second employee but refuses a repeat by the first', { skip }, async () => {
  const t = await token();
  await scan(e1, t, 1);
  await assert.rejects(scan(e1, t, 2), (e) => e.code === 'token_already_scanned');
  assert.equal((await scan(e2, t, 2)).action, 'check_in');
  assert.equal(await count('attendance_records'), 2);
});

test('token is consumed only on commit: a failure while writing the record rolls the consumption back', { skip }, async () => {
  const t = await token();
  // present with late minutes violates attendance_late_only_when_late AFTER the token was updated in the same transaction
  await assert.rejects(scan(e1, t, 1, { checkIn: { status: 'present', lateMinutes: 5 } }), /attendance_late_only_when_late/);
  assert.equal((await tokenUsed(t)).used_at, null);
  assert.equal(await count('attendance_records'), 0);
  assert.equal((await query(`SELECT count(*)::int n FROM audit_logs WHERE action LIKE 'attendance.%'`)).rows[0].n, 0); // the audit row rolled back too
  const out = await scan(e1, t, 1); // the same token still works afterwards
  assert.equal(out.action, 'check_in');
});

test('late check-in keeps the supplied status and minutes; check-out keeps them', { skip }, async () => {
  const out = await scan(e1, await token(), 1, { checkIn: { status: 'late', lateMinutes: 12 } });
  assert.deepEqual([out.record.status, out.record.late_minutes], ['late', 12]);
  const done = await scan(e1, await extraToken(2), 2);
  assert.deepEqual([done.record.status, done.record.late_minutes], ['late', 12]);
});

test('a pre-created absent row is filled in by the check-in; an on_leave row refuses and keeps the token', { skip }, async () => {
  await query(`INSERT INTO attendance_records (employee_id, work_date, status) VALUES ($1,$2,'absent')`, [e1.id, DAY]);
  const out = await scan(e1, await token(), 1);
  assert.equal(out.action, 'check_in');
  assert.equal(await count('attendance_records'), 1);
  assert.equal(out.record.status, 'present');
  await query(`DELETE FROM attendance_records`);
  await query(`INSERT INTO attendance_records (employee_id, work_date, status) VALUES ($1,$2,'on_leave')`, [e1.id, DAY]);
  const t = await extraToken(2);
  await assert.rejects(scan(e1, t, 2), (e) => e.code === 'on_leave');
  assert.equal((await tokenUsed(t)).used_at, null);
});

test('an incomplete row with a check-in is completed by the check-out and returns to present/late', { skip }, async () => {
  await query(`INSERT INTO attendance_records (employee_id, work_date, check_in_at, status) VALUES ($1,$2, now() - interval '8 hours','incomplete')`, [e1.id, DAY]);
  const out = await scan(e1, await token(), 1);
  assert.equal(out.action, 'check_out');
  assert.equal(out.record.status, 'present');
});

test('concurrency: two simultaneous scans with the SAME token (two people) -> both succeed', { skip }, async () => {
  const t = await token();
  const results = await Promise.allSettled([scan(e1, t, 1), scan(e2, t, 2)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.equal(await count('attendance_records'), 2);
});

test('concurrency: two simultaneous check-ins by ONE person (different tokens) -> one record, the loser keeps its token', { skip }, async () => {
  const t1 = await extraToken(1), t2 = await extraToken(2);
  const results = await Promise.allSettled([scan(e1, t1, 1), scan(e1, t2, 2)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.findIndex((r) => r.status === 'rejected');
  assert.equal(results[lost].reason.code, 'duplicate_scan');
  assert.equal(await count('attendance_records'), 1);
  assert.equal((await tokenUsed(lost === 0 ? t1 : t2)).used_at, null);
});

test('expired or unissued tokens are refused inside the transaction too', { skip }, async () => {
  const t = await token();
  await query(`UPDATE attendance_tokens SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'`);
  await assert.rejects(scan(e1, t, 1), (e) => e.code === 'token_expired');
  await assert.rejects(scan(e1, 'N'.repeat(43), 1), (e) => e.code === 'invalid_token');
  assert.equal(await count('attendance_records'), 0);
});

test('submitScan: a failed database write deletes the uploaded photo and leaves token and records untouched', { skip }, async () => {
  const t = await token();
  const deleted = [];
  const photos = { upload: async () => photo(7), delete: async (id) => { deleted.push(id); return 'ok'; } };
  await assert.rejects(
    submitScan({ employeeId: e1.id, userId: e1.userId, token: t, photo: Buffer.from([1]), workDate: DAY, photos,
      checkIn: { status: 'present', lateMinutes: 5 } }), // violates attendance_late_only_when_late inside the transaction
    /attendance_late_only_when_late/);
  assert.deepEqual(deleted, [photo(7)]);
  assert.equal(await count('attendance_records'), 0);
  assert.equal((await tokenUsed(t)).used_at, null);
});

test('submitScan: success keeps the photo', { skip }, async () => {
  const deleted = [];
  const photos = { upload: async () => photo(8), delete: async (id) => { deleted.push(id); return 'ok'; } };
  const out = await submitScan({ employeeId: e1.id, userId: e1.userId, token: await token(), photo: Buffer.from([1]), workDate: DAY, photos });
  assert.equal(out.record.check_in_photo_id, photo(8));
  assert.deepEqual(deleted, []);
});

// 2.16: the status is computed inside the transaction from the shift and the SAME database clock that is stored as check_in_at.
test('classifyForEmployee in the real transaction: late minutes match the stored check-in time', { skip }, async () => {
  await query(`UPDATE shifts SET start_time = '00:00', grace_minutes = 0, work_days = '{1,2,3,4,5,6,7}'`);
  try {
    const today = companyDate();
    const out = await applyScan({ employeeId: e1.id, userId: e1.userId, token: await token(), workDate: today, photoId: photo(1), classify: classifyForEmployee });
    const { rows: [r] } = await query(
      `SELECT status, late_minutes, ceil(floor(extract(epoch FROM (check_in_at AT TIME ZONE 'Africa/Addis_Ababa')::time)) / 60)::int AS expected
         FROM attendance_records WHERE id = $1`, [out.record.id]);
    assert.equal(r.status, 'late'); // (only the first second after midnight would be 'present')
    assert.equal(r.late_minutes, r.expected); // the classifier works in whole seconds (sub-seconds are dropped), so compare at that granularity
  } finally { await query(`UPDATE shifts SET start_time = '09:00', grace_minutes = 0, work_days = '{1,2,3,4,5}'`); }
});

test('classifyForEmployee on a day that is not a work day: present, 0 minutes, passes the DB CHECK', { skip }, async () => {
  await query(`UPDATE shifts SET work_days = '{1}'`);
  try {
    const out = await applyScan({ employeeId: e1.id, userId: e1.userId, token: await token(), workDate: '2026-10-24', photoId: photo(2), classify: classifyForEmployee });
    assert.deepEqual([out.record.status, out.record.late_minutes], ['present', 0]); // 2026-10-24 is a Saturday
  } finally { await query(`UPDATE shifts SET work_days = '{1,2,3,4,5}'`); }
});

test('concurrency: duplicate submissions by one employee on the same QR never check out', { skip }, async () => {
  const t = await token();
  const results = await Promise.allSettled([scan(e1,t,1),scan(e1,t,2)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'token_already_scanned');
  assert.equal(await count('attendance_token_scans'),1);
  assert.equal((await query('SELECT check_out_at FROM attendance_records')).rows[0].check_out_at,null);
});
