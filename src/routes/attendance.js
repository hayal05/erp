import express, { Router } from 'express';
import { query } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireEmployee } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { checkQrToken } from '../services/qrToken.js';
import { parseScanBody, MAX_BASE64_CHARS } from '../services/scanRequest.js';
import { submitScan, companyDate, companyTime } from '../services/attendance.js';
import { classifyForEmployee } from '../services/attendanceStatus.js';
import { photos } from '../services/cloudinary.js';
import { validate } from '../middleware/validate.js';
import { validationError } from '../services/dbErrors.js';
import { myAttendanceQuery } from '../services/hrSchemas.js';
import { pageOffset, pageResult } from '../services/sql.js';
import { config } from '../config.js';

// The photo store is a swappable dependency so tests can run without Cloudinary.
export const scanDeps = { photos };

// Employee QR attendance submit (spec 7 step 4): authenticate, validate the request, check the employee is active,
// validate the token (2.12), then decide in/out, upload the selfie and run the transaction that consumes the token and
// writes the record (2.13-2.15, services/attendance.js). A check-in is classified present/late from the employee's
// shift inside that transaction (2.16, services/attendanceStatus.js).
// Bad tokens are counted per user (an employee cannot hammer the endpoint with guesses).
export const scanLimits = { user: createLimiter({ windowMs: 5 * 60_000, max: 10 }) };

// The selfie arrives as base64 in JSON (~800 KB at the 600 KB cap), so this route has its own body limit.
// server.js skips the global 100 kb parser for this path; it is applied here, after the role guard, so an
// anonymous caller can never make the server parse a large body.
const scanJson = express.json({ limit: Math.ceil((MAX_BASE64_CHARS + 1024) / 1024) + 'kb' });

const router = Router();
router.use(noStore, requireEmployee);

router.post('/scan', scanJson, wrap(async (req, res) => {
  const key = String(req.user.id);
  const gate = scanLimits.user.check(key);
  if (gate.blocked) {
    res.set('Retry-After', String(gate.retryAfterSec));
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.', 'rate_limited', { retryAfterSeconds: gate.retryAfterSec });
  }

  const { token, photo } = parseScanBody(req.body); // 400 validation (token shape, JPEG magic bytes, size)

  // The person must have an active employee record. Checked before the token so an inactive account learns nothing about codes.
  const { rows: [emp] } = await query(
    `SELECT e.id, e.status, e.employee_code, u.full_name FROM employees e JOIN users u ON u.id = e.user_id WHERE e.user_id = $1`, [req.user.id]);
  if (!emp) throw new HttpError(403, 'Your account has no employee record. Contact HR.', 'no_employee_record');
  if (emp.status !== 'active') throw new HttpError(403, 'Your employee record is inactive. Contact HR.', 'employee_inactive');

  try {
    await checkQrToken({ query }, token);
  } catch (e) {
    if (e instanceof HttpError) scanLimits.user.fail(key);
    throw e;
  }

  // Refuse duplicates early (before any upload), upload the selfie, then run the transaction (token + record).
  // The photo is deleted if the transaction fails. See services/attendance.js submitScan / applyScan.
  const workDate = companyDate();
  const { action, record } = await submitScan({ employeeId: emp.id, userId: req.user.id, token, photo, workDate, photos: scanDeps.photos, classify: classifyForEmployee });
  // Confirmation payload (spec 7 step 5). No photo id, no token.
  res.status(201).json({
    action,
    workDate,
    employee: { fullName: emp.full_name, employeeCode: emp.employee_code },
    at: action === 'check_out' ? record.check_out_at : record.check_in_at,
    atTime: companyTime(action === 'check_out' ? record.check_out_at : record.check_in_at), // HH:MM, company timezone
    checkInAt: record.check_in_at,
    checkOutAt: record.check_out_at,
    checkInTime: companyTime(record.check_in_at),
    checkOutTime: companyTime(record.check_out_at),
    status: record.status,
    lateMinutes: record.late_minutes,
  });
}));

// GET /mine?page&pageSize&from&to -> { items, page, pageSize, total }: the signed-in employee's OWN attendance, newest first.
// The employee is taken from the session, never from the request, so nobody can ask for another person's rows. Photos, photo
// ids and correction reasons are not included (HR-only); `corrected` just tells the person HR adjusted the row.
router.get('/mine', validate(myAttendanceQuery, 'query'), wrap(async (req, res) => {
  const q = req.query;
  if (q.from && q.to && q.from > q.to) throw validationError({ to: 'Must be on or after the start date' });
  // $1 is always the user; the filters are numbered after it. The data query appends the timezone, limit and offset.
  const where = ['e.user_id = $1'], params = [req.user.id];
  if (q.from) { params.push(q.from); where.push(`a.work_date >= $${params.length}`); }
  if (q.to) { params.push(q.to); where.push(`a.work_date <= $${params.length}`); }
  const WHERE = where.join(' AND '), n0 = params.length;
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    query(`SELECT a.id, to_char(a.work_date, 'YYYY-MM-DD') AS work_date,
             to_char(a.check_in_at AT TIME ZONE $${n0 + 1}::text, 'HH24:MI') AS check_in_time,
             to_char(a.check_out_at AT TIME ZONE $${n0 + 1}::text, 'HH24:MI') AS check_out_time,
             a.status, a.late_minutes, (a.corrected_at IS NOT NULL) AS corrected
           FROM attendance_records a JOIN employees e ON e.id = a.employee_id
           WHERE ${WHERE} ORDER BY a.work_date DESC, a.id DESC LIMIT $${n0 + 2} OFFSET $${n0 + 3}`,
    [...params, config.company.timezone, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n FROM attendance_records a JOIN employees e ON e.id = a.employee_id WHERE ${WHERE}`, params),
  ]);
  const items = rows.map((r) => ({ id: Number(r.id), workDate: r.work_date, checkInTime: r.check_in_time, checkOutTime: r.check_out_time,
    status: r.status, lateMinutes: r.late_minutes, corrected: r.corrected }));
  res.json(pageResult(items, q, n));
}));

export default router;
