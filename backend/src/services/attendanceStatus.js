import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';
import { dayNumber as strictDayNumber } from './workdays.js'; // rejects impossible dates (2026-02-30)

// Check-in status and late minutes (spec 8, task 2.16). MVP rules (documented in README, task 5.7):
//   - Same-day shifts only: the shift starts and ends on the work date (DB CHECK end_time > start_time).
//   - Lateness is measured against the shift start in the COMPANY timezone, never the server's or the browser's.
//   - A check-in up to and including start + grace is 'present' (late_minutes 0). One second later it is 'late'.
//   - late_minutes counts from the shift START (not from the end of the grace period), rounded UP to whole minutes,
//     so a 'late' row always has late_minutes >= 1.
//   - A scan on a day that is not one of the shift's work days, or is a public holiday, is 'present' with 0 late minutes
//     (nothing to be late for).
//   - Approved leave (task 3.8): a scan on a day covered by approved leave is refused (409 on_leave), the same answer the
//     scan gives when an on_leave row already exists. HR can correct the record if the employee really worked.
//   - Days with no scan are filled in by fillAttendanceGaps: 'on_leave' (approved leave) or 'absent' (a working day that
//     has ended), never on days off or holidays.
export const PRESENT = Object.freeze({ status: 'present', lateMinutes: 0 });

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

// Wall-clock date ('YYYY-MM-DD') and seconds since midnight of an instant in a time zone.
export function companyParts(at, timeZone = config.company.timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, seconds: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second) };
}

const dayNumber = (ymd) => { const [, y, m, d] = DATE_RE.exec(ymd); return Date.UTC(+y, +m - 1, +d) / 86_400_000; };

// ISO weekday of a calendar date: 1 = Monday ... 7 = Sunday (the same numbering as shifts.work_days).
export function isoWeekday(ymd) {
  if (!DATE_RE.test(ymd)) throw new Error('workDate must be YYYY-MM-DD');
  const dow = new Date(dayNumber(ymd) * 86_400_000).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

export function timeToSeconds(t) {
  const m = TIME_RE.exec(String(t));
  if (!m) throw new Error('shift start time must be HH:MM or HH:MM:SS');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

// Pure. `at` is the check-in instant (Date), `workDate` 'YYYY-MM-DD', `shift` { startTime, graceMinutes, workDays }.
// `holiday` (boolean): the work date is a public holiday. Returns { status: 'present' | 'late', lateMinutes }.
export function classifyCheckIn({ at, workDate, shift, holiday = false, timeZone = config.company.timezone }) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new Error('at must be a valid Date');
  if (!shift) throw new Error('shift is required');
  if (holiday || !(Array.isArray(shift.workDays) && shift.workDays.map(Number).includes(isoWeekday(workDate)))) return PRESENT;

  const startSec = timeToSeconds(shift.startTime);
  const graceSec = Math.max(0, Number(shift.graceMinutes) || 0) * 60;
  const p = companyParts(at, timeZone);
  // If the instant falls on a different company date than the work date (a scan right at midnight), count the whole days.
  const elapsed = (dayNumber(p.date) - dayNumber(workDate)) * 86_400 + p.seconds - startSec;
  if (elapsed <= graceSec) return PRESENT;
  return { status: 'late', lateMinutes: Math.ceil(elapsed / 60) };
}

// Used INSIDE the scan transaction (applyScan) for a check-in. One query returns the employee's shift, the database
// clock, whether the work date is a holiday and whether approved leave covers it. Postgres now() is fixed for the whole
// transaction, so this is exactly the instant the INSERT/UPDATE stores as check_in_at, and the status can never
// disagree with the stored timestamp. Approved leave refuses the scan (409 on_leave) and so rolls the transaction back.
export async function classifyForEmployee(db, { employeeId, workDate, timeZone = config.company.timezone }) {
  const { rows: [row] } = await db.query(
    `SELECT now() AS at, s.start_time::text AS start_time, s.grace_minutes, s.work_days,
            EXISTS (SELECT 1 FROM holidays h WHERE h.holiday_date = $2::date) AS is_holiday,
            EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = e.id AND l.status = 'approved'
                     AND $2::date BETWEEN l.start_date AND l.end_date) AS on_leave
       FROM employees e JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1`, [employeeId, workDate]);
  if (!row) throw new Error('employee has no shift'); // shift_id is NOT NULL + FK, so this means the employee row is gone
  if (row.on_leave) throw new HttpError(409, 'You are on approved leave today. Contact HR if this is wrong.', 'on_leave');
  return classifyCheckIn({
    at: new Date(row.at), workDate, timeZone, holiday: row.is_holiday,
    shift: { startTime: row.start_time, graceMinutes: row.grace_minutes, workDays: row.work_days },
  });
}

// ---- days without a scan (task 3.8)
// Pure. What a day with NO attendance row should become: 'on_leave', 'absent' or null (leave it alone).
//   working  - the date is one of the shift's work days and not a holiday
//   onLeave  - approved leave covers the date
//   closed   - the working day is over (a past date, or today after the shift end)
// Approved leave counts even before the day is over, so a scan on a leave day is refused from the start of the day.
export function missingDayStatus({ working, onLeave, closed }) {
  if (!working) return null;
  if (onLeave) return 'on_leave';
  return closed ? 'absent' : null;
}

export const MAX_FILL_DAYS = 366;
export const FILL_BACK_DAYS = 62, FILL_DEFAULT_DAYS = 31;

// Pure. The dates the HR attendance list fills for a request { from?, to? } on `today` (company date): the requested dates,
// never earlier than 62 days back and never later than today (leave days still to come were written when the leave was
// approved); with no dates, the last 31 days. null when nothing is left to fill.
export function fillWindow({ from, to } = {}, today) {
  const shift = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const earliest = shift(today, -FILL_BACK_DAYS);
  let lo = from ?? shift(today, -FILL_DEFAULT_DAYS), hi = to ?? today;
  if (lo < earliest) lo = earliest;
  if (hi > today) hi = today;
  return lo > hi ? null : { from: lo, to: hi };
}


// Writes the missing rows for from..to ('YYYY-MM-DD', inclusive), for all active employees or just `employeeId`.
// One INSERT ... SELECT: every active employee (already started) on each of their shift's work days that is not a holiday
// and has no row yet gets 'on_leave' (approved leave covers it) or 'absent' (the day has ended). Rows that exist are never
// touched (ON CONFLICT DO NOTHING), so it is safe to call as often as needed and runs without a scheduler: the HR attendance
// list calls it for the dates on screen and leave approval calls it for the approved range.
// `today` / `time` default to the company-timezone date and wall-clock time now (injectable for tests).
// Returns { onLeave, absent } = how many rows were created.
export async function fillAttendanceGaps(db, { from, to, employeeId = null, now = new Date(), timeZone = config.company.timezone }) {
  const a = strictDayNumber(from), b = strictDayNumber(to); // throws on impossible dates
  if (b < a) throw new Error('to must be on or after from');
  if (b - a + 1 > MAX_FILL_DAYS) throw new Error(`A fill is limited to ${MAX_FILL_DAYS} days`);
  const p = companyParts(now, timeZone);
  const clock = `${String(Math.floor(p.seconds / 3600)).padStart(2, '0')}:${String(Math.floor((p.seconds % 3600) / 60)).padStart(2, '0')}:${String(p.seconds % 60).padStart(2, '0')}`;
  const { rows } = await db.query(
    `WITH cand AS (
       SELECT e.id AS employee_id, g.d::date AS work_date,
              EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = e.id AND l.status = 'approved'
                       AND g.d::date BETWEEN l.start_date AND l.end_date) AS on_leave,
              (g.d::date < $3::date OR (g.d::date = $3::date AND $4::time > s.end_time)) AS closed
         FROM generate_series($1::date, $2::date, interval '1 day') AS g(d)
         CROSS JOIN employees e
         JOIN shifts s ON s.id = e.shift_id
        WHERE e.status = 'active' AND e.start_date <= g.d::date
          AND ($5::bigint IS NULL OR e.id = $5)
          AND EXTRACT(ISODOW FROM g.d)::int = ANY (s.work_days)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.holiday_date = g.d::date))
     INSERT INTO attendance_records (employee_id, work_date, status)
     SELECT employee_id, work_date, CASE WHEN on_leave THEN 'on_leave' ELSE 'absent' END
       FROM cand WHERE on_leave OR closed
     ON CONFLICT ON CONSTRAINT attendance_one_per_day DO NOTHING
     RETURNING status`,
    [from, to, p.date, clock, employeeId]);
  return { onLeave: rows.filter((r) => r.status === 'on_leave').length, absent: rows.filter((r) => r.status === 'absent').length };
}

// After HR approves leave covering from..to: rows that were already marked 'absent' (no check-in) for those dates become
// 'on_leave' (a retroactive approval), then the missing on_leave rows are created, including future days, so a scan on a
// leave day is refused from the first minute of it. Rows with a check-in are left alone (the person did work).
// Runs inside the approval transaction. Returns the number of rows converted/created.
export async function applyApprovedLeaveToAttendance(db, { employeeId, from, to, now = new Date() }) {
  const { rows: converted } = await db.query(
    `UPDATE attendance_records a SET status = 'on_leave'
      WHERE a.employee_id = $1 AND a.work_date BETWEEN $2::date AND $3::date
        AND a.status = 'absent' AND a.check_in_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.holiday_date = a.work_date)
      RETURNING a.id`, [employeeId, from, to]);
  const created = await fillAttendanceGaps(db, { from, to, employeeId, now });
  return converted.length + created.onLeave;
}
