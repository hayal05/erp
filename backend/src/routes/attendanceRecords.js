import {approvalWrap as wrap} from '../middleware/approval.js';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { pageOffset, pageResult } from '../services/sql.js';
import { validationError } from '../services/dbErrors.js';
import { attendanceCorrection, attendanceListQuery, idParams, photoParams } from '../services/hrSchemas.js';
import { classifyCheckIn, fillAttendanceGaps, fillWindow } from '../services/attendanceStatus.js';
import { attendanceRange } from '../services/attendanceRange.js';
import { companyDate } from '../services/attendance.js';
import { photos } from '../services/cloudinary.js';

// HR view of attendance (spec 8, tasks 2.17-2.18), mounted at /api/attendance-records. It is a separate router from the
// employee scan endpoint (/api/attendance) because that one is guarded for employees only. requireHr is default-deny
// while the screen is locked (423), so a locked tablet cannot read, correct or view photos.
export const recordDeps = { photos, fillGaps: (q) => fillGapsFor(q) }; // swappable in tests, like scanDeps (tests that count rows turn the gap fill off)

const router = Router();
router.use(noStore, requirePermission('attendance.read'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('attendance.manage')(req,res,next));

// $1 is always the company timezone: times are shown as wall-clock HH:MM there, never in the browser's zone.
const FROM = `FROM attendance_records a
  JOIN employees e ON e.id = a.employee_id
  JOIN users u ON u.id = e.user_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN users cu ON cu.id = a.corrected_by_user_id`;
const COLUMNS = `a.id, a.employee_id, e.employee_code, u.full_name, e.department_id, d.name AS department_name,
  to_char(a.work_date, 'YYYY-MM-DD') AS work_date, a.check_in_at, a.check_out_at,
  to_char(a.check_in_at AT TIME ZONE $1::text, 'HH24:MI') AS check_in_time,
  to_char(a.check_out_at AT TIME ZONE $1::text, 'HH24:MI') AS check_out_time,
  a.status, a.late_minutes,
  (a.check_in_photo_id IS NOT NULL) AS has_check_in_photo, (a.check_out_photo_id IS NOT NULL) AS has_check_out_photo,
  a.corrected_at, cu.full_name AS corrected_by_name, a.correction_reason`;

// Photo ids (Cloudinary public ids) never leave the server: records only say whether a photo exists.
export const toRecord = (r) => ({
  id: Number(r.id), employeeId: Number(r.employee_id), employeeCode: r.employee_code, fullName: r.full_name,
  departmentId: r.department_id == null ? null : Number(r.department_id), departmentName: r.department_name,
  workDate: r.work_date, checkInAt: r.check_in_at, checkOutAt: r.check_out_at, checkInTime: r.check_in_time, checkOutTime: r.check_out_time,
  status: r.status, lateMinutes: r.late_minutes,
  hasCheckInPhoto: r.has_check_in_photo, hasCheckOutPhoto: r.has_check_out_photo,
  correctedAt: r.corrected_at, correctedByName: r.corrected_by_name, correctionReason: r.correction_reason,
});
async function findRecord(db, id) {
  const { rows: [r] } = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE a.id = $2`, [config.company.timezone, id]);
  return r ? toRecord(r) : null;
}
const notFound = () => new HttpError(404, 'Attendance record not found', 'not_found');

// Task 3.8: there is no scheduler, so the absent / on-leave rows for the dates being looked at are written when HR looks
// (idempotent, existing rows are never touched); see fillWindow for which dates.
export async function fillGapsFor(q, today = companyDate()) {
  const window = fillWindow(q, today);
  return window ? fillAttendanceGaps({ query }, window) : null;
}

// GET /?page&pageSize&from&to&employeeId&departmentId&status -> { items, page, pageSize, total, today }, newest date first.
// `today` is the company-timezone date, so the page can offer "Today" without trusting the browser's clock or zone.
router.get('/', validate(attendanceListQuery, 'query'), wrap(async (req, res) => {
  const today = companyDate();
  const q = { ...req.query };
  if (q.from && q.to && q.from > q.to) throw validationError({ to: 'Must be on or after the start date' });
  Object.assign(q, attendanceRange(q, today));
  if (q.from && q.to && q.from > q.to) return res.json({ ...pageResult([], q, 0), today });
  await recordDeps.fillGaps(q);
  const filters = [[q.from, 'a.work_date >= $?'], [q.to, 'a.work_date <= $?'], [q.employeeId, 'a.employee_id = $?'],
    [q.departmentId, 'e.department_id = $?'], [q.status, 'a.status = $?']].filter(([value]) => value !== undefined);
  // Placeholders are numbered from `base` (the data query reserves $1 for the timezone). Column names are fixed text above.
  const build = (base) => ({
    sql: filters.length ? `WHERE ${filters.map(([, c], i) => c.replace('$?', `$${base + i + 1}`)).join(' AND ')}` : '',
    params: filters.map(([value]) => value),
  });
  const data = build(1), count = build(0);
  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    query(`SELECT ${COLUMNS} ${FROM} ${data.sql}
           ORDER BY a.work_date DESC, lower(u.full_name), a.id LIMIT $${data.params.length + 2} OFFSET $${data.params.length + 3}`,
    [config.company.timezone, ...data.params, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n ${FROM} ${count.sql}`, count.params),
  ]);
  res.json({ ...pageResult(rows.map(toRecord), q, total), today });
}));

// PATCH /:id: HR correction (spec 8). A reason is REQUIRED. Body (all optional except reason; omitted = unchanged):
//   status, checkInTime / checkOutTime ('HH:MM' in the company timezone on the record's work date; null clears), lateMinutes.
// Runs in one transaction with the row locked (a live scan for the same person waits, then sees the corrected row).
// Rules checked here for clear field messages (the DB CHECKs are the backstop): Present/Late need a check-in, a check-out
// needs a check-in and must be later, late minutes only for Late (and Late needs >= 1; if omitted they are recomputed
// from the shift, or kept when the check-in time did not change). Stamps corrected_by/at/reason and writes an audit row
// with the reason and each changed value (from/to). Selfies are never changed by a correction.
router.patch('/:id', validate(idParams, 'params'), validate(attendanceCorrection), wrap(async (req, res) => {
  const { id } = req.params;
  const b = req.body;
  const tz = config.company.timezone;
  const has = (k) => Object.hasOwn(b, k);

  const record = await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query(
      `SELECT a.*, to_char(a.work_date, 'YYYY-MM-DD') AS wd FROM attendance_records a WHERE a.id = $1 FOR UPDATE`, [id]);
    if (!cur) throw notFound();

    const at = async (time) => (time == null ? null
      : (await db.query(`SELECT (($1::date + $2::time) AT TIME ZONE $3::text) AS t`, [cur.wd, time, tz])).rows[0].t);
    const checkIn = has('checkInTime') ? await at(b.checkInTime) : cur.check_in_at;
    const checkOut = has('checkOutTime') ? await at(b.checkOutTime) : cur.check_out_at;
    const status = b.status ?? cur.status;

    const errors = {};
    if (['present', 'late'].includes(status) && !checkIn) errors.checkInTime = 'Required when the status is Present or Late';
    if (checkOut && !checkIn) errors.checkOutTime = 'A check-out needs a check-in time';
    else if (checkOut && checkIn && checkOut <= checkIn) errors.checkOutTime = 'Must be after the check-in time';

    let late = 0;
    if (status === 'late') {
      if (b.lateMinutes !== undefined) late = b.lateMinutes;
      else if (cur.status === 'late' && cur.late_minutes > 0 && !has('checkInTime')) late = cur.late_minutes;
      else if (checkIn) {
        const { rows: [s] } = await db.query(
          `SELECT s.start_time::text AS start_time, s.grace_minutes, s.work_days FROM employees e JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1`, [cur.employee_id]);
        late = classifyCheckIn({ at: checkIn, workDate: cur.wd, timeZone: tz,
          shift: { startTime: s.start_time, graceMinutes: s.grace_minutes, workDays: s.work_days } }).lateMinutes;
      }
      if (late < 1 && !errors.checkInTime) errors.lateMinutes = 'Enter how many minutes late (at least 1)';
    } else if (b.lateMinutes > 0) errors.lateMinutes = 'Late minutes apply only to the Late status';
    if (Object.keys(errors).length) throw validationError(errors);

    const iso = (d) => (d ? new Date(d).toISOString() : null);
    const before = { status: cur.status, lateMinutes: cur.late_minutes, checkInAt: iso(cur.check_in_at), checkOutAt: iso(cur.check_out_at) };
    const after = { status, lateMinutes: late, checkInAt: iso(checkIn), checkOutAt: iso(checkOut) };
    const changes = diffFields(before, after, Object.keys(before));
    if (!Object.keys(changes).length) throw new HttpError(400, 'Nothing was changed', 'no_change');

    await db.query(
      `UPDATE attendance_records SET status = $2, late_minutes = $3, check_in_at = $4, check_out_at = $5,
              corrected_by_user_id = $6, corrected_at = now(), correction_reason = $7 WHERE id = $1`,
      [id, status, late, checkIn, checkOut, req.user.id, b.reason]);
    await audit(db, { actorId: req.user.id, action: 'attendance.correct', entityType: 'attendance_record', entityId: id,
      reason: b.reason, details: { employeeId: Number(cur.employee_id), workDate: cur.wd, changes } });
    return findRecord(db, id);
  });
  res.json(record);
}));

// GET /:id/photos/check_in|check_out -> { url, expiresAt }: a signed, time-limited (5 min) link for HR to view one selfie.
// Never cached (noStore) and never stored. Each view is audited (who looked at whose selfie), without the photo id.
router.get('/:id/photos/:kind', requirePermission('attendance.manage'), validate(photoParams, 'params'), wrap(async (req, res) => {
  const { id, kind } = req.params;
  const column = kind === 'check_in' ? 'check_in_photo_id' : 'check_out_photo_id';
  const { rows: [r] } = await query(`SELECT employee_id, ${column} AS photo_id FROM attendance_records WHERE id = $1`, [id]);
  if (!r) throw notFound();
  if (!r.photo_id) throw new HttpError(404, 'No photo for this record', 'no_photo');
  const signed = await recordDeps.photos.signedUrl(r.photo_id); // 503 when Cloudinary is not configured
  await audit({ query }, { actorId: req.user.id, action: 'attendance.photo_view', entityType: 'attendance_record', entityId: id, details: { kind, employeeId: Number(r.employee_id) } });
  res.json(signed);
}));

export default router;
