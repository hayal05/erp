import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireEmployee } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { idParams, leaveBalanceQuery, leaveRequestBody, myLeaveQuery } from '../services/hrSchemas.js';
import { pageOffset, pageResult } from '../services/sql.js';
import { companyDate } from '../services/attendance.js';
import { activeEmployeeForUser, balanceRows, cancelLeaveRequest, createLeaveRequest, REQUEST_COLUMNS, requestView } from '../services/leave.js';

// Employee leave (spec 10, task 3.3): leave types, own balances, own requests, request + cancel.
// The employee is ALWAYS the signed-in user (never read from the request), so nobody can see or file for someone else.
// HR decisions live in routes/leaveAdmin.js (task 3.4), like attendance / attendance-records.
const router = Router();
router.use(noStore, requireEmployee);

router.get('/types', wrap(async (req, res) => {
  const { rows } = await query('SELECT id, code, name, is_paid, has_balance FROM leave_types ORDER BY id');
  res.json({ items: rows.map((t) => ({ id: Number(t.id), code: t.code, name: t.name, isPaid: t.is_paid, hasBalance: t.has_balance })) });
}));

// GET /balances?year= (default: this year in the company timezone) -> { year, items: [one per leave type] }
router.get('/balances', validate(leaveBalanceQuery, 'query'), wrap(async (req, res) => {
  const emp = await activeEmployeeForUser({ query }, req.user.id);
  const year = req.query.year ?? Number(companyDate().slice(0, 4));
  res.json({ year, items: await balanceRows({ query }, emp.id, year) });
}));

// GET /requests?page&pageSize&status&year -> { items, page, pageSize, total }, newest first
router.get('/requests', validate(myLeaveQuery, 'query'), wrap(async (req, res) => {
  const q = req.query;
  const where = ['e.user_id = $1'], params = [req.user.id];
  if (q.status) { params.push(q.status); where.push(`r.status = $${params.length}`); }
  if (q.year) { params.push(q.year); where.push(`r.start_date BETWEEN make_date($${params.length}, 1, 1) AND make_date($${params.length}, 12, 31)`); }
  const WHERE = where.join(' AND '), n0 = params.length;
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    query(`SELECT ${REQUEST_COLUMNS} FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id JOIN employees e ON e.id = r.employee_id
            WHERE ${WHERE} ORDER BY r.start_date DESC, r.id DESC LIMIT $${n0 + 1} OFFSET $${n0 + 2}`, [...params, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n FROM leave_requests r JOIN employees e ON e.id = r.employee_id WHERE ${WHERE}`, params),
  ]);
  res.json(pageResult(rows.map(requestView), q, n));
}));

// POST /requests { leaveTypeId, startDate, endDate, reason } -> 201 the new PENDING request (days counted by the server)
router.post('/requests', validate(leaveRequestBody), wrap(async (req, res) => {
  const emp = await activeEmployeeForUser({ query }, req.user.id);
  const request = await withTransaction((tx) => createLeaveRequest(tx, { employeeId: emp.id, userId: req.user.id, ...req.body }));
  res.status(201).json(request);
}));

// POST /requests/:id/cancel -> the request, now cancelled. Pending requests only.
router.post('/requests/:id/cancel', validate(idParams, 'params'), wrap(async (req, res) => {
  const emp = await activeEmployeeForUser({ query }, req.user.id);
  res.json(await withTransaction((tx) => cancelLeaveRequest(tx, { employeeId: emp.id, userId: req.user.id, id: req.params.id })));
}));

export default router;
