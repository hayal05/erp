// Leave rules (spec 10, task 3.3). Pure helpers first, then the database functions the routes share
// (the employee API now; the HR decisions in 3.4 and the attendance link in 3.8 reuse them).
// Decisions (see plan/project status.md): whole working days; a request stays inside one calendar year; a balance is
// ENTITLEMENT + HR adjustment minus approved days (used) minus pending days; no balance row = the type's default_days.
import { HttpError } from '../middleware/error.js';
import { validationError } from './dbErrors.js';
import { audit } from './audit.js';
import { workingDaysForEmployee } from './workdays.js';
import { applyApprovedLeaveToAttendance } from './attendanceStatus.js';

// ---- pure
// { field: message } for a date pair that is out of order or crosses a year boundary ({} = fine). Both are 'YYYY-MM-DD'.
export function checkLeaveDates(start, end) {
  if (end < start) return { endDate: 'Must be on or after the start date' };
  if (start.slice(0, 4) !== end.slice(0, 4)) return { endDate: 'A request must stay within one calendar year. Submit one request per year' };
  return {};
}

// Raw SQL row (counts may arrive as strings or numbers) -> API shape. `remaining` is what can still be requested.
export function shapeBalance(r) {
  const entitled = Number(r.entitled), adjusted = Number(r.adjusted), used = Number(r.used), pending = Number(r.pending);
  const hasBalance = r.has_balance;
  return { leaveTypeId: Number(r.id), code: r.code, name: r.name, isPaid: r.is_paid, hasBalance,
    entitled, adjusted, total: entitled + adjusted, used, pending,
    remaining: hasBalance ? entitled + adjusted - used - pending : null };
}

// ---- database (`db` = the pool or a transaction client)
// One row per leave type (or just `typeId`) with the numbers for `year`. Used/pending come from the requests themselves.
export async function balanceRows(db, employeeId, year, typeId = null) {
  const { rows } = await db.query(
    `SELECT t.id, t.code, t.name, t.is_paid, t.has_balance,
            coalesce(b.entitled_days, t.default_days) AS entitled, coalesce(b.adjusted_days, 0) AS adjusted,
            coalesce(sum(r.days) FILTER (WHERE r.status = 'approved'), 0)::int AS used,
            coalesce(sum(r.days) FILTER (WHERE r.status = 'pending'), 0)::int AS pending
       FROM leave_types t
       LEFT JOIN leave_balances b ON b.leave_type_id = t.id AND b.employee_id = $1 AND b.year = $2::int
       LEFT JOIN leave_requests r ON r.leave_type_id = t.id AND r.employee_id = $1
                                 AND r.start_date BETWEEN make_date($2::int, 1, 1) AND make_date($2::int, 12, 31)
      WHERE ($3::bigint IS NULL OR t.id = $3)
      GROUP BY t.id, b.id ORDER BY t.id`, [employeeId, year, typeId]);
  return rows.map(shapeBalance);
}

// The signed-in person's active employee record, or the same 403s the attendance routes give.
export async function activeEmployeeForUser(db, userId) {
  const { rows: [emp] } = await db.query('SELECT id, status FROM employees WHERE user_id = $1', [userId]);
  if (!emp) throw new HttpError(403, 'Your account has no employee record. Contact HR.', 'no_employee_record');
  if (emp.status !== 'active') throw new HttpError(403, 'Your employee record is inactive. Contact HR.', 'employee_inactive');
  return { id: Number(emp.id) };
}

export const REQUEST_COLUMNS = `r.id, r.leave_type_id, t.code AS type_code, t.name AS type_name,
  to_char(r.start_date, 'YYYY-MM-DD') AS start_date, to_char(r.end_date, 'YYYY-MM-DD') AS end_date,
  r.days, r.reason, r.status, r.decision_remarks, r.decided_at, r.created_at`;

export const requestView = (r) => ({ id: Number(r.id), leaveTypeId: Number(r.leave_type_id), leaveType: r.type_code, leaveTypeName: r.type_name,
  startDate: r.start_date, endDate: r.end_date, days: r.days, reason: r.reason, status: r.status,
  decisionRemarks: r.decision_remarks, decidedAt: r.decided_at, createdAt: r.created_at });

async function loadRequest(db, id) {
  const { rows: [r] } = await db.query(`SELECT ${REQUEST_COLUMNS} FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id WHERE r.id = $1`, [id]);
  return requestView(r);
}

// Creates a PENDING request. Must run inside a transaction (`tx`): the employee row is locked first, so one person's
// simultaneous requests are checked one after the other and cannot jointly overspend a balance or overlap.
export async function createLeaveRequest(tx, { employeeId, userId, leaveTypeId, startDate, endDate, reason }) {
  await tx.query('SELECT 1 FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
  const { rows: [type] } = await tx.query('SELECT id, name, has_balance FROM leave_types WHERE id = $1', [leaveTypeId]);
  if (!type) throw validationError({ leaveTypeId: 'Leave type not found' });
  const bad = checkLeaveDates(startDate, endDate);
  if (Object.keys(bad).length) throw validationError(bad);

  const { days } = await workingDaysForEmployee(tx, { employeeId, start: startDate, end: endDate });
  if (days < 1) throw validationError({ startDate: 'No working days in this range (days off and holidays are not counted)' });

  // Overlap with the person's own pending or approved leave. (The DB also guarantees no overlapping APPROVED leave.)
  const { rows: [clash] } = await tx.query(
    `SELECT to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e, status FROM leave_requests
      WHERE employee_id = $1 AND status IN ('pending', 'approved') AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`,
    [employeeId, startDate, endDate]);
  if (clash) {
    const msg = `You already have ${clash.status} leave from ${clash.s} to ${clash.e}`;
    throw new HttpError(409, msg, 'leave_overlap', { fields: { startDate: msg } });
  }

  if (type.has_balance) {
    const [bal] = await balanceRows(tx, employeeId, Number(startDate.slice(0, 4)), type.id);
    if (days > bal.remaining) {
      const msg = `This request needs ${days} day(s) but you have ${Math.max(bal.remaining, 0)} left of ${type.name.toLowerCase()} for ${startDate.slice(0, 4)}`;
      throw new HttpError(409, msg, 'insufficient_balance', { fields: { leaveTypeId: msg }, remaining: bal.remaining, requested: days });
    }
  }

  const { rows: [row] } = await tx.query(
    `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [employeeId, type.id, startDate, endDate, days, reason]);
  await audit(tx, { actorId: userId, action: 'leave.request', entityType: 'leave_request', entityId: row.id,
    details: { employeeId, leaveTypeId: Number(type.id), startDate, endDate, days } });
  return loadRequest(tx, row.id);
}

// The employee withdraws their own PENDING request. Someone else's request looks exactly like a missing one (404).
export async function cancelLeaveRequest(tx, { employeeId, userId, id }) {
  const { rows: [r] } = await tx.query('SELECT status FROM leave_requests WHERE id = $1 AND employee_id = $2 FOR UPDATE', [id, employeeId]);
  if (!r) throw new HttpError(404, 'Leave request not found', 'not_found');
  if (r.status !== 'pending') throw new HttpError(409, `Only a pending request can be cancelled (this one is ${r.status})`, 'not_pending');
  await tx.query(`UPDATE leave_requests SET status = 'cancelled' WHERE id = $1`, [id]);
  await audit(tx, { actorId: userId, action: 'leave.cancel', entityType: 'leave_request', entityId: id, details: { employeeId } });
  return loadRequest(tx, id);
}

// ---- HR decisions and balances (task 3.4). Both run inside a transaction (`tx`).
// Locks the request's employee first (same order as createLeaveRequest, so no deadlock), then the request itself.
export async function decideLeaveRequest(tx, { id, userId, decision, remarks = null }) {
  const { rows: [head] } = await tx.query('SELECT employee_id FROM leave_requests WHERE id = $1', [id]);
  if (!head) throw new HttpError(404, 'Leave request not found', 'not_found');
  await tx.query('SELECT 1 FROM employees WHERE id = $1 FOR UPDATE', [head.employee_id]);
  const { rows: [r] } = await tx.query(
    `SELECT status, to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e FROM leave_requests WHERE id = $1 FOR UPDATE`, [id]);
  if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}`, 'not_pending');
  if (decision === 'approved') { // friendly message first; the exclusion constraint (23P01) remains the guarantee
    const { rows: [clash] } = await tx.query(
      `SELECT to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e FROM leave_requests
        WHERE employee_id = $1 AND status = 'approved' AND id <> $2 AND daterange(start_date, end_date, '[]') && daterange($3::date, $4::date, '[]') LIMIT 1`,
      [head.employee_id, id, r.s, r.e]);
    if (clash) throw overlapError(clash);
  }
  try {
    await tx.query(`UPDATE leave_requests SET status = $2, decided_by_user_id = $3, decided_at = now(), decision_remarks = $4 WHERE id = $1`,
      [id, decision, userId, remarks]);
  } catch (e) {
    if (e.code === '23P01') throw overlapError({ s: r.s, e: r.e });
    throw e;
  }
  // Task 3.8: approved leave drives attendance. Same transaction, so a failure here rolls the approval back too.
  const attendanceRows = decision === 'approved'
    ? await applyApprovedLeaveToAttendance(tx, { employeeId: head.employee_id, from: r.s, to: r.e }) : undefined;
  await audit(tx, { actorId: userId, action: decision === 'approved' ? 'leave.approve' : 'leave.reject', entityType: 'leave_request', entityId: id,
    reason: remarks, details: { employeeId: Number(head.employee_id), ...(attendanceRows === undefined ? {} : { attendanceRows }) } });
  return loadRequest(tx, id);
}
const overlapError = (c) => { const msg = `The employee already has approved leave from ${c.s} to ${c.e}`; return new HttpError(409, msg, 'leave_overlap', { fields: { _: msg } }); };

// Sets the entitlement and/or changes HR's adjustment for one employee/type/year (creates the row from default_days when missing).
// Refused when the new total would fall below what is already approved + pending ("no invalid balances").
export async function changeBalance(tx, { userId, employeeId, leaveTypeId, year, entitledDays, adjustDays, reason }) {
  if (entitledDays === undefined && adjustDays === undefined) throw validationError({ entitledDays: 'Give an entitlement or an adjustment' });
  const { rows: [emp] } = await tx.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
  if (!emp) throw validationError({ employeeId: 'Employee not found' });
  const { rows: [type] } = await tx.query('SELECT id, name, has_balance, default_days FROM leave_types WHERE id = $1', [leaveTypeId]);
  if (!type) throw validationError({ leaveTypeId: 'Leave type not found' });
  if (!type.has_balance) throw validationError({ leaveTypeId: `${type.name} has no balance to change` });

  const [before] = await balanceRows(tx, employeeId, year, type.id);
  const entitled = entitledDays ?? before.entitled, adjusted = before.adjusted + (adjustDays ?? 0);
  if (entitled + adjusted < 0) throw validationError({ [entitledDays !== undefined && adjustDays === undefined ? 'entitledDays' : 'adjustDays']: 'The total cannot be negative' });
  if (entitled + adjusted < before.used + before.pending) {
    const msg = `Total ${entitled + adjusted} would be below the ${before.used + before.pending} day(s) already approved or pending`;
    throw new HttpError(409, msg, 'below_used', { fields: { [entitledDays !== undefined ? 'entitledDays' : 'adjustDays']: msg } });
  }
  try {
    await tx.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days, adjusted_days) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET entitled_days = EXCLUDED.entitled_days, adjusted_days = EXCLUDED.adjusted_days`,
      [employeeId, type.id, year, entitled, adjusted]);
  } catch (e) {
    if (e.code === '23514') throw validationError({ adjustDays: 'The total cannot be negative' });
    throw e;
  }
  const [after] = await balanceRows(tx, employeeId, year, type.id);
  await audit(tx, { actorId: userId, action: 'leave.balance_adjust', entityType: 'leave_balance', entityId: `${employeeId}:${type.id}:${year}`, reason,
    details: { employeeId: Number(employeeId), leaveTypeId: Number(type.id), year, entitled: { from: before.entitled, to: entitled }, adjusted: { from: before.adjusted, to: adjusted } } });
  return after;
}
