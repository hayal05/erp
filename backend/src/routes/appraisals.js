import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { noStore } from '../middleware/noStore.js';
import { validate, v } from '../middleware/validate.js';
import { coversEmployee, scopeSql } from '../services/accessScope.js';
import { likePattern, pageOffset, pageResult, pageSchema } from '../services/sql.js';

const router = Router();
router.use(noStore, requirePermission('appraisals.read'));

router.get('/employees', validate({ ...pageSchema, search: v.string({ max: 120 }) }, 'query'), wrap(async (req, res) => {
  const filters = req.query;
  const args = [filters.search ? likePattern(filters.search) : null];
  const scope = scopeSql(req.user, 'appraisals.read', 'e', args);
  const from = `FROM employees e JOIN users u ON u.id=e.user_id
    LEFT JOIN departments d ON d.id=e.department_id
    WHERE e.status='active' AND u.is_active AND ${scope}
      AND ($1::text IS NULL OR u.full_name ILIKE $1 OR e.employee_code ILIKE $1)`;
  const result = await withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await db.query(`SELECT e.id, e.department_id, e.employee_code, u.full_name, d.name AS department
      ${from} ORDER BY lower(u.full_name), e.id LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, filters.pageSize, pageOffset(filters)]);
    const { rows: [count] } = await db.query(`SELECT count(*)::int AS total ${from}`, args);
    const items = rows.map(row => ({
      id: Number(row.id), employeeCode: row.employee_code, fullName: row.full_name, department: row.department,
      canReview: coversEmployee(req.user, 'appraisals.review', row.id, row.department_id),
      canApprove: coversEmployee(req.user, 'appraisals.approve', row.id, row.department_id),
    }));
    return pageResult(items, filters, count.total);
  });
  res.json(result);
}));

export default router;
