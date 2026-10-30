import crypto from 'node:crypto';
import { HttpError } from '../middleware/error.js';
import { audit } from './audit.js';
import { checkQrToken, alreadyScannedError } from './qrToken.js';
import { isPhotoId, photos as defaultPhotos } from './cloudinary.js';
import { config } from '../config.js';
import { PRESENT, classifyForEmployee } from './attendanceStatus.js';

// Attendance decision logic (spec 8). One QR flow serves both check-in and check-out, so the SERVER decides which one
// this scan is from the employee's record for the work date; the browser never says "check out". That makes a
// check-out before a check-in impossible by construction (spec 26 #10), and a second check-in the same day a refusal.
export const ACTION = Object.freeze({ CHECK_IN: 'check_in', CHECK_OUT: 'check_out' });

// Pure. `record` is the attendance_records row for (employee, work date), or null/undefined when there is none.
// Returns ACTION.CHECK_IN or ACTION.CHECK_OUT, or throws the HttpError that explains why the scan is refused.
//   no row                          -> check in
//   row without check-in (absent)   -> check in (the classifier may have pre-created it; the scan fills it in)
//   on_leave row without check-in   -> refused: approved leave, nothing to scan (HR can correct it)
//   checked in, not out             -> check out (also when status is 'incomplete')
//   checked in and out              -> refused: the day is complete, so a second check-in cannot happen
export function nextAction(record) {
  if (!record) return ACTION.CHECK_IN;
  if (!record.check_in_at) {
    if (record.status === 'on_leave') throw new HttpError(409, 'You are on approved leave today. Contact HR if this is wrong.', 'on_leave');
    return ACTION.CHECK_IN;
  }
  if (!record.check_out_at) return ACTION.CHECK_OUT;
  throw new HttpError(409, 'You have already checked in and out today.', 'already_checked_out');
}

// Reads the employee's row for the work date and decides. With { lock: true } (inside the 2.14 transaction) the row is
// locked FOR UPDATE, so two simultaneous scans by one person queue up and the second sees the first one's result.
// When there is no row yet nothing can be locked: the UNIQUE (employee_id, work_date) constraint is the guard then,
// and the insert in 2.14 must turn its unique violation (23505, attendance_one_per_day) into a 409.
// `db` is a pool or a transaction client; `workDate` is 'YYYY-MM-DD' in the company timezone (computed by 2.16).
export async function decideAction(db, employeeId, workDate, { lock = false } = {}) {
  const { rows: [record] } = await db.query(
    `SELECT * FROM attendance_records WHERE employee_id = $1 AND work_date = $2${lock ? ' FOR UPDATE' : ''}`,
    [employeeId, workDate]);
  return { action: nextAction(record), record: record ?? null };
}

// Loaded lazily so the pure logic above can be unit-tested without the pg driver.
const lazyDb = { query: async (...a) => (await import('../db/pool.js')).query(...a) };
const defaultRun = async (fn) => (await import('../db/pool.js')).withTransaction(fn);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Status after a check-out: a row marked 'incomplete' (no check-out at end of day) that gets completed becomes
// late/present again from its stored late minutes; every other status is kept.
export const statusAfterCheckOut = (record) =>
  record.status === 'incomplete' ? (record.late_minutes > 0 ? 'late' : 'present') : record.status;

// Shared token lock -> employee receipt -> attendance row -> audit, all in one transaction.
// The unique (token, employee) receipt prevents a retry from becoming a check-out.
// Different employees share the token lock and can commit independently. QR replacement
// takes an exclusive lock, so it cannot invalidate a token midway through a commit.
export async function applyScan({ employeeId, userId, token, workDate, photoId, checkIn = PRESENT, classify = null, run = defaultRun }) {
  if (!DATE_RE.test(String(workDate))) throw new HttpError(500, 'Invalid work date', 'server_error');
  if (!isPhotoId(photoId)) throw new HttpError(500, 'Invalid photo reference', 'server_error');

  return run(async (db) => {
    const tok = await checkQrToken(db, token, { lock: true });
    const { rows: receipts } = await db.query(
      `INSERT INTO attendance_token_scans (token_id, employee_id) VALUES ($1, $2)
       ON CONFLICT (token_id, employee_id) DO NOTHING RETURNING token_id`, [tok.id, employeeId]);
    if (!receipts.length) throw alreadyScannedError();
    const { action, record } = await decideAction(db, employeeId, workDate, { lock: true });

    const status = action === ACTION.CHECK_IN && classify ? await classify(db, { employeeId, workDate }) : checkIn;

    let row;
    if (action === ACTION.CHECK_IN && !record) {
      ({ rows: [row] } = await db.query(
        `INSERT INTO attendance_records (employee_id, work_date, check_in_at, check_in_photo_id, status, late_minutes)
         VALUES ($1, $2, now(), $3, $4, $5)
         ON CONFLICT ON CONSTRAINT attendance_one_per_day DO NOTHING RETURNING *`,
        [employeeId, workDate, photoId, status.status, status.lateMinutes]));
      // No row existed when we looked, but a simultaneous scan (another token, same person) got in first.
      if (!row) throw new HttpError(409, 'Your scan was already recorded.', 'duplicate_scan');
    } else if (action === ACTION.CHECK_IN) { // a pre-created absent row: the scan fills it in
      ({ rows: [row] } = await db.query(
        `UPDATE attendance_records SET check_in_at = now(), check_in_photo_id = $2, status = $3, late_minutes = $4
          WHERE id = $1 AND check_in_at IS NULL RETURNING *`,
        [record.id, photoId, status.status, status.lateMinutes]));
    } else {
      ({ rows: [row] } = await db.query(
        `UPDATE attendance_records SET check_out_at = now(), check_out_photo_id = $2, status = $3
          WHERE id = $1 AND check_out_at IS NULL RETURNING *`,
        [record.id, photoId, statusAfterCheckOut(record)]));
    }
    if (!row) throw new HttpError(409, 'Your scan was already recorded.', 'duplicate_scan');

    await audit(db, { actorId: userId, action: `attendance.${action}`, entityType: 'attendance_record', entityId: row.id, details: { workDate } });
    return { action, record: row };
  });
}

// Today's date in the company timezone as 'YYYY-MM-DD' (the work date; never the UTC date).
export function companyDate(now = new Date(), timeZone = config.company.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// 'HH:MM' wall-clock time of an instant in the company timezone (null stays null). The browser's zone is never used to show times.
export function companyTime(instant, timeZone = config.company.timezone) {
  if (instant == null) return null;
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

// Upload-before-commit (spec 7 step 4), the whole submit:
//   0. cheap refusal check first (already done today, on leave): no upload for a scan that cannot succeed
//   1. upload the selfie. If this fails nothing else happens: no attendance, no scan receipt (callers see 502/503)
//   2. applyScan (the transaction). If it fails for ANY reason the uploaded photo is deleted, then the original error is rethrown
// A failed delete never hides the original error. Log only a one-way reference for later orphan reconciliation;
// never log the private photo identifier. Retention/deletion guidance covers uploads left behind by a crash.
export async function submitScan({ employeeId, userId, token, photo, workDate, checkIn, classify,
  photos = defaultPhotos, apply = applyScan, decide = (id, date) => decideAction(lazyDb, id, date),
  log = (...a) => console.error(...a) }) {
  await decide(employeeId, workDate); // throws 409 on_leave / already_checked_out before any upload

  const photoId = await photos.upload(photo);
  try {
    return await apply({ employeeId, userId, token, workDate, photoId, checkIn, classify });
  } catch (err) {
    try { await photos.delete(photoId); }
    catch { const reference = crypto.createHash('sha256').update(photoId).digest('hex').slice(0, 16); log(`[orphan-photo] cleanup failed; reference=${reference}`); }
    throw err;
  }
}
