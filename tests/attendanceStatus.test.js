import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCheckIn, classifyForEmployee, isoWeekday, timeToSeconds, companyParts, PRESENT,
  missingDayStatus, fillAttendanceGaps, applyApprovedLeaveToAttendance, MAX_FILL_DAYS } from '../src/services/attendanceStatus.js';
import { applyScan } from '../src/services/attendance.js';

// Africa/Addis_Ababa is UTC+3 all year (no DST). 2026-10-19 is a Monday, 2026-10-24 a Saturday.
const TZ = 'Africa/Addis_Ababa';
const MON = '2026-10-19';
const SHIFT = { startTime: '09:00:00', graceMinutes: 10, workDays: [1, 2, 3, 4, 5] };
// Local wall time on the Monday -> instant.
const at = (hhmmss, date = MON) => new Date(`${date}T${hhmmss}+03:00`);
const run = (time, over = {}) => classifyCheckIn({ at: at(time), workDate: MON, shift: { ...SHIFT, ...over }, timeZone: TZ });

test('before the start and exactly at the start: present, 0 minutes', () => {
  assert.deepEqual(run('08:30:00'), PRESENT);
  assert.deepEqual(run('09:00:00'), PRESENT);
});

test('inside the grace period, including the last second of it: present', () => {
  assert.deepEqual(run('09:05:00'), PRESENT);
  assert.deepEqual(run('09:10:00'), PRESENT);
});

test('one second past the grace period is late; minutes count from the shift START, rounded up', () => {
  assert.deepEqual(run('09:10:01'), { status: 'late', lateMinutes: 11 });
  assert.deepEqual(run('09:11:00'), { status: 'late', lateMinutes: 11 });
  assert.deepEqual(run('09:11:01'), { status: 'late', lateMinutes: 12 });
  assert.deepEqual(run('10:30:00'), { status: 'late', lateMinutes: 90 });
});

test('zero grace: one second after the start is late by 1 minute (never late with 0 minutes)', () => {
  assert.deepEqual(run('09:00:00', { graceMinutes: 0 }), PRESENT);
  assert.deepEqual(run('09:00:01', { graceMinutes: 0 }), { status: 'late', lateMinutes: 1 });
});

test('uses the shift start and grace it is given', () => {
  assert.deepEqual(run('07:44:00', { startTime: '07:30', graceMinutes: 15 }), PRESENT);
  assert.deepEqual(run('07:46:00', { startTime: '07:30', graceMinutes: 15 }), { status: 'late', lateMinutes: 16 });
});

test('the company timezone decides, not UTC: 06:30Z is 09:30 in Addis', () => {
  const instant = new Date('2026-10-19T06:30:00Z');
  assert.deepEqual(classifyCheckIn({ at: instant, workDate: MON, shift: SHIFT, timeZone: TZ }), { status: 'late', lateMinutes: 30 });
  // The same instant read in UTC is 06:30, before the shift: present. Proves the zone is applied.
  assert.deepEqual(classifyCheckIn({ at: instant, workDate: MON, shift: SHIFT, timeZone: 'UTC' }), PRESENT);
});

test('a scan on a day that is not a work day is present with 0 late minutes', () => {
  const sat = '2026-10-24';
  assert.deepEqual(classifyCheckIn({ at: at('11:00:00', sat), workDate: sat, shift: SHIFT, timeZone: TZ }), PRESENT);
  const satShift = { ...SHIFT, workDays: [6] };
  assert.deepEqual(classifyCheckIn({ at: at('11:00:00', sat), workDate: sat, shift: satShift, timeZone: TZ }), { status: 'late', lateMinutes: 120 });
});

test('work days from the database may arrive as numbers or numeric strings', () => {
  assert.deepEqual(run('10:00:00', { workDays: ['1', '2'] }), { status: 'late', lateMinutes: 60 });
});

test('an instant just after midnight on the next company date counts whole days (no negative or wrapped minutes)', () => {
  const r = classifyCheckIn({ at: at('00:05:00', '2026-10-20'), workDate: MON, shift: SHIFT, timeZone: TZ });
  assert.equal(r.status, 'late');
  assert.equal(r.lateMinutes, 24 * 60 + 5 - 9 * 60);
});

test('late_minutes > 0 only ever comes with status late (matches the DB CHECK)', () => {
  for (const t of ['06:00:00', '09:00:00', '09:10:00', '09:10:01', '12:00:00', '23:59:59']) {
    const r = run(t);
    assert.ok(r.lateMinutes === 0 || r.status === 'late', t);
    if (r.status === 'late') assert.ok(r.lateMinutes >= 1, t);
  }
});

test('isoWeekday: Monday 1 ... Sunday 7', () => {
  assert.equal(isoWeekday('2026-10-19'), 1);
  assert.equal(isoWeekday('2026-10-24'), 6);
  assert.equal(isoWeekday('2026-10-25'), 7);
  assert.throws(() => isoWeekday('19/10/2026'));
});

test('timeToSeconds accepts HH:MM and HH:MM:SS and rejects junk', () => {
  assert.equal(timeToSeconds('09:00'), 32400);
  assert.equal(timeToSeconds('09:00:30'), 32430);
  for (const bad of ['9:00', '24:00', '09:60', '', null, 'noon']) assert.throws(() => timeToSeconds(bad), String(bad));
});

test('companyParts returns the wall date and seconds in the zone', () => {
  assert.deepEqual(companyParts(new Date('2026-10-19T22:30:15Z'), TZ), { date: '2026-10-20', seconds: 1 * 3600 + 30 * 60 + 15 });
  assert.deepEqual(companyParts(new Date('2026-10-19T21:00:00Z'), TZ), { date: '2026-10-20', seconds: 0 }); // midnight is 00:00, not 24:00
});

test('invalid input throws instead of guessing', () => {
  assert.throws(() => classifyCheckIn({ at: new Date('nope'), workDate: MON, shift: SHIFT }));
  assert.throws(() => classifyCheckIn({ at: at('09:00:00'), workDate: MON, shift: null }));
  assert.throws(() => classifyCheckIn({ at: at('09:00:00'), workDate: MON, shift: { ...SHIFT, startTime: 'x' } }));
  assert.throws(() => classifyCheckIn({ at: at('09:00:00'), workDate: 'bad', shift: SHIFT }));
});

// ---- classifyForEmployee: one query, shift + DB clock + holiday/leave flags, params are the employee id and the work date
test('classifyForEmployee reads shift and database clock in one query and classifies', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ at: '2026-10-19T06:20:00Z', start_time: '09:00:00', grace_minutes: 10, work_days: [1, 2, 3, 4, 5], is_holiday: false, on_leave: false }] };
  } };
  const out = await classifyForEmployee(db, { employeeId: 7, workDate: MON, timeZone: TZ });
  assert.deepEqual(out, { status: 'late', lateMinutes: 20 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [7, MON]);
  assert.match(calls[0].sql, /now\(\)/);
  assert.match(calls[0].sql, /JOIN shifts/);
});

const lateRow = (over) => ({ query: async () => ({ rows: [{ at: '2026-10-19T06:20:00Z', start_time: '09:00:00', grace_minutes: 10, work_days: [1, 2, 3, 4, 5], is_holiday: false, on_leave: false, ...over }] }) });

test('a public holiday is present with 0 minutes even long after the shift start (task 3.8)', async () => {
  assert.deepEqual(await classifyForEmployee(lateRow({ is_holiday: true }), { employeeId: 7, workDate: MON, timeZone: TZ }), PRESENT);
  assert.deepEqual(classifyCheckIn({ at: at('11:00:00'), workDate: MON, shift: SHIFT, holiday: true, timeZone: TZ }), PRESENT);
  assert.equal(classifyCheckIn({ at: at('11:00:00'), workDate: MON, shift: SHIFT, holiday: false, timeZone: TZ }).status, 'late');
});

test('a scan on a day of approved leave is refused with 409 on_leave (task 3.8)', async () => {
  await assert.rejects(classifyForEmployee(lateRow({ on_leave: true }), { employeeId: 7, workDate: MON, timeZone: TZ }),
    (e) => e.status === 409 && e.code === 'on_leave');
});

test('classifyForEmployee fails loudly when the employee has no shift row', async () => {
  await assert.rejects(classifyForEmployee({ query: async () => ({ rows: [] }) }, { employeeId: 7, workDate: MON }));
});

// ---- applyScan uses classify only for a check-in, inside the transaction, before the write
const PHOTO = 'natra/selfies/2026/' + 'a'.repeat(24);
const TOKEN = 'T'.repeat(43);
function fakeTx(record = null) {
  const log = [];
  const db = { query: async (text, params) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    log.push({ sql, params });
    if (/FROM attendance_tokens/.test(text)) return { rows: [{ id: 1, issued_by_session_id: 's1', used: false, expired: false, issuer_ok: true }] };
    if (/FROM attendance_records/.test(text)) return { rows: record ? [record] : [] };
    if (/UPDATE attendance_tokens/.test(text)) return { rowCount: 1, rows: [] };
    if (/INSERT INTO audit_logs/.test(text)) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 9, status: 'late' }] };
  } };
  return { log, db, run: (fn) => fn(db) };
}
const base = (run, extra) => ({ employeeId: 7, userId: 3, token: TOKEN, workDate: MON, photoId: PHOTO, run, ...extra });

test('applyScan: a first check-in stores the classified status and late minutes', async () => {
  const { log, run: tx, db } = fakeTx();
  const seen = [];
  const classify = async (d, a) => { seen.push([d === db, a]); return { status: 'late', lateMinutes: 25 }; };
  await applyScan(base(tx, { classify }));
  assert.deepEqual(seen, [[true, { employeeId: 7, workDate: MON }]]);
  const insert = log.find((c) => /^INSERT INTO attendance_records/.test(c.sql));
  assert.deepEqual(insert.params, [7, MON, PHOTO, 'late', 25]);
  // classification happens after the token is consumed's lock but before the write
  const idx = (re) => log.findIndex((c) => re.test(c.sql));
  assert.ok(idx(/^INSERT INTO attendance_records/) > idx(/FROM attendance_records.*FOR UPDATE/));
});

test('applyScan: a pre-created absent row is filled in with the classified status', async () => {
  const { log, run: tx } = fakeTx({ id: 5, status: 'absent', check_in_at: null, check_out_at: null });
  await applyScan(base(tx, { classify: async () => ({ status: 'late', lateMinutes: 40 }) }));
  const upd = log.find((c) => /^UPDATE attendance_records SET check_in_at/.test(c.sql));
  assert.deepEqual(upd.params, [5, PHOTO, 'late', 40]);
});

test('applyScan: classify is NOT called for a check-out, and the status is kept', async () => {
  const { log, run: tx } = fakeTx({ id: 5, status: 'late', late_minutes: 25, check_in_at: new Date(), check_out_at: null });
  let called = false;
  await applyScan(base(tx, { classify: async () => { called = true; return { status: 'present', lateMinutes: 0 }; } }));
  assert.equal(called, false);
  const upd = log.find((c) => /^UPDATE attendance_records SET check_out_at/.test(c.sql));
  assert.equal(upd.params[2], 'late');
});

test('applyScan: classify is NOT called when the scan is refused (completed day)', async () => {
  const { run: tx } = fakeTx({ id: 5, status: 'present', check_in_at: new Date(), check_out_at: new Date(Date.now() + 1000) });
  let called = false;
  await assert.rejects(applyScan(base(tx, { classify: async () => { called = true; return PRESENT; } })), (e) => e.code === 'already_checked_out');
  assert.equal(called, false);
});

test('applyScan: a failing classify aborts the whole transaction (rejects, nothing is written after it)', async () => {
  const { log, run: tx } = fakeTx();
  await assert.rejects(applyScan(base(tx, { classify: async () => { throw new Error('no shift'); } })), /no shift/);
  assert.equal(log.some((c) => /^INSERT INTO (attendance_records|audit_logs)/.test(c.sql)), false);
});

test('applyScan: without classify the fixed checkIn (or present/0) is used, as before', async () => {
  const a = fakeTx();
  await applyScan(base(a.run));
  assert.deepEqual(a.log.find((c) => /^INSERT INTO attendance_records/.test(c.sql)).params, [7, MON, PHOTO, 'present', 0]);
  const b = fakeTx();
  await applyScan(base(b.run, { checkIn: { status: 'late', lateMinutes: 3 } }));
  assert.deepEqual(b.log.find((c) => /^INSERT INTO attendance_records/.test(c.sql)).params, [7, MON, PHOTO, 'late', 3]);
});

// ---- task 3.8: days without a scan
test('missingDayStatus: leave beats absence, days off and open days stay empty', () => {
  assert.equal(missingDayStatus({ working: false, onLeave: true, closed: true }), null); // day off / holiday: nothing to record
  assert.equal(missingDayStatus({ working: true, onLeave: true, closed: false }), 'on_leave'); // leave counts before the day ends
  assert.equal(missingDayStatus({ working: true, onLeave: true, closed: true }), 'on_leave');
  assert.equal(missingDayStatus({ working: true, onLeave: false, closed: true }), 'absent');
  assert.equal(missingDayStatus({ working: true, onLeave: false, closed: false }), null); // today, shift not over yet
});

function recorder(rowsFor = () => []) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, ' '), params }); return { rows: rowsFor(sql) }; } };
}

test('fillAttendanceGaps sends the range, the company date and clock, and counts what was created', async () => {
  const db = recorder(() => [{ status: 'on_leave' }, { status: 'absent' }, { status: 'absent' }]);
  const now = new Date('2026-10-19T14:30:15+03:00'); // 14:30:15 company time
  const out = await fillAttendanceGaps(db, { from: '2026-10-12', to: '2026-10-19', now, timeZone: TZ });
  assert.deepEqual(out, { onLeave: 1, absent: 2 });
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, ['2026-10-12', '2026-10-19', '2026-10-19', '14:30:15', null]);
  assert.match(db.calls[0].sql, /ON CONFLICT ON CONSTRAINT attendance_one_per_day DO NOTHING/); // never touches an existing row
  assert.match(db.calls[0].sql, /holidays/);
  assert.match(db.calls[0].sql, /status = 'approved'/);
  assert.match(db.calls[0].sql, /e\.status = 'active'/);
  assert.match(db.calls[0].sql, /ISODOW/);
});

test('fillAttendanceGaps can be limited to one employee and refuses bad ranges', async () => {
  const db = recorder();
  await fillAttendanceGaps(db, { from: '2026-10-19', to: '2026-10-19', employeeId: 9, timeZone: TZ });
  assert.equal(db.calls[0].params[4], 9);
  await assert.rejects(fillAttendanceGaps(db, { from: '2026-10-20', to: '2026-10-19' }), /on or after/);
  await assert.rejects(fillAttendanceGaps(db, { from: '2026-02-30', to: '2026-03-02' }), /not a real date/);
  await assert.rejects(fillAttendanceGaps(db, { from: '2025-01-01', to: '2026-12-31' }), new RegExp(String(MAX_FILL_DAYS)));
  assert.equal(db.calls.length, 1); // refused before touching the database
});

test('applyApprovedLeaveToAttendance converts absent rows without check-in first, then creates the missing rows', async () => {
  const db = recorder((sql) => (/^UPDATE attendance_records/.test(sql.trim()) ? [{ id: 1 }, { id: 2 }] : [{ status: 'on_leave' }]));
  const n = await applyApprovedLeaveToAttendance(db, { employeeId: 5, from: '2026-10-19', to: '2026-10-21', now: new Date('2026-10-19T12:00:00+03:00') });
  assert.equal(n, 3);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /UPDATE attendance_records/);
  assert.match(db.calls[0].sql, /status = 'absent' AND a\.check_in_at IS NULL/); // a row with a check-in is never rewritten
  assert.deepEqual(db.calls[0].params, [5, '2026-10-19', '2026-10-21']);
  assert.equal(db.calls[1].params[4], 5);
});
