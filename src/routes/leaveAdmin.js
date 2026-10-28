import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { wrap } from '../middleware/error.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { idParams, leaveApproveBody, leaveBalanceChange, leaveHrBalanceQuery, leaveHrListQuery, leaveRejectBody } from '../services/hrSchemas.js';
import { pageOffset, pageResult } from '../services/sql.js';
import { companyDate } from '../services/attendance.js';
import { balanceRows, changeBalance, decideLeaveRequest, REQUEST_COLUMNS, requestView } from '../services/leave.js';

// HR leave (spec 10, task 3.4), mounted at /api/leave-admin. Locked tablets get 423 (default-deny in requireHr).
const router = Router();
router.use(noStore, requireHr);

// GET /requests?page&pageSize&status&year&employeeId&departmentId -> pending first, then newest
router.get('/requests', validate(leaveHrListQuery, 'query'), wrap(async (req, res) => {
  const q = req.query, where = ['true'], params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (q.status) add('r.status = ?', q.status);
  if (q.employeeId) add('r.employee_id = ?', q.employeeId);
  if (q.departmentId) add('e.department_id = ?', q.departmentId);
  if (q.year) add('r.start_date BETWEEN make_date(?, 1, 1) AND make_date(?, 12, 31)', q.year);
  const WHERE = where.join(' AND '), n0 = params.length;
  const FROM = 'FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id JOIN employees e ON e.id = r.employee_id JOIN users u ON u.id = e.user_id';
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    query(`SELECT ${REQUEST_COLUMNS}, r.employee_id, e.employee_code, u.full_name ${FROM} WHERE ${WHERE}
            ORDER BY (r.status = 'pending') DESC, r.start_date DESC, r.id DESC LIMIT $${n0 + 1} OFFSET $${n0 + 2}`, [...params, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n ${FROM} WHERE ${WHERE}`, params),
  ]);
  res.json(pageResult(rows.map((r) => ({ ...requestView(r), employeeId: Number(r.employee_id), employeeCode: r.employee_code, employeeName: r.full_name })), q, n));
}));

const decide = (decision, schema) => [validate(idParams, 'params'), validate(schema), wrap(async (req, res) => {
  res.json(await withTransaction((tx) => decideLeaveRequest(tx, { id: req.params.id, userId: req.user.id, decision, remarks: req.body.remarks ?? null })));
})];
router.post('/requests/:id/approve', ...decide('approved', leaveApproveBody)); // remarks optional
router.post('/requests/:id/reject', ...decide('rejected', leaveRejectBody));   // remarks required

// GET /balances?employeeId&year -> { year, items: one per leave type }
router.get('/balances', validate(leaveHrBalanceQuery, 'query'), wrap(async (req, res) => {
  const year = req.query.year ?? Number(companyDate().slice(0, 4));
  res.json({ year, items: await balanceRows({ query }, req.query.employeeId, year) });
}));

// POST /balances { employeeId, leaveTypeId, year, entitledDays?, adjustDays?, reason } -> the updated balance. Reason is mandatory and audited.
router.post('/balances', validate(leaveBalanceChange), wrap(async (req, res) => {
  res.json(await withTransaction((tx) => changeBalance(tx, { userId: req.user.id, ...req.body })));
}));

export default router;
