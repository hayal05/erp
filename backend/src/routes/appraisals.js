import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { noStore } from '../middleware/noStore.js';
import { validate, v } from '../middleware/validate.js';
import { coversEmployee, scopeSql } from '../services/accessScope.js';
import { likePattern, pageOffset, pageResult, pageSchema } from '../services/sql.js';

import reviewRoutes from './appraisalReviews.js';
import cycleRoutes from './appraisalCycles.js';
import templateRoutes from './appraisalTemplates.js';
import { appraisalMatchJoin, toAppraisalMatch } from '../services/appraisalTemplates.js';

const router = Router();
router.use(noStore, requirePermission('appraisals.read'));
router.use('/templates', templateRoutes);
router.use('/cycles', cycleRoutes);
router.use('/reviews', reviewRoutes);

router.get('/employees', validate({ ...pageSchema, search: v.string({ max: 120 }) }, 'query'), wrap(async (req, res) => {
  const filters = req.query;
  const args = [filters.search ? likePattern(filters.search) : null];
  const scope = scopeSql(req.user, 'appraisals.read', 'e', args);
  const from = `FROM employees e JOIN users u ON u.id=e.user_id
    LEFT JOIN departments d ON d.id=e.department_id`;
  const where = `WHERE e.status='active' AND u.is_active AND ${scope}
      AND ($1::text IS NULL OR u.full_name ILIKE $1 OR e.employee_code ILIKE $1)`;
  const result = await withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await db.query(`
      WITH selected AS (
        SELECT e.id, e.department_id, e.position_id, e.job_grade_id, e.employee_code, u.full_name, d.name AS department
        ${from} ${where} ORDER BY lower(u.full_name), e.id LIMIT $${args.length + 1} OFFSET $${args.length + 2}
      )
      SELECT e.*, match.candidate_count, match.candidate_name, match.candidate_id, match.priority
      FROM selected e ${appraisalMatchJoin} ORDER BY lower(e.full_name), e.id
    `, [...args, filters.pageSize, pageOffset(filters)]);
    const { rows: [count] } = await db.query(`SELECT count(*)::int AS total ${from} ${where}`, args);
    const items = rows.map(row => ({
      id: Number(row.id), employeeCode: row.employee_code, fullName: row.full_name, department: row.department,
      template: toAppraisalMatch(row),
      canReview: coversEmployee(req.user, 'appraisals.review', row.id, row.department_id),
      canApprove: coversEmployee(req.user, 'appraisals.approve', row.id, row.department_id),
    }));
    return pageResult(items, filters, count.total);
  });
  res.json(result);
}));

router.get('/assignments', requirePermission('appraisals.review'), validate(pageSchema, 'query'), wrap(async (req, res) => {
  const args = [req.user.id];
  const scope = scopeSql(req.user, 'appraisals.review', 'e', args);
  const { rows: [result] } = await query(`
    WITH eligible AS (
      SELECT c.id AS "cycleId", c.name AS cycle, to_char(c.due_on,'YYYY-MM-DD') AS "dueOn",
        e.id AS "employeeId", u.full_name AS employee, e.employee_code AS "employeeCode",
        a.template_version AS "templateVersion", CASE WHEN r.submitted_at IS NOT NULL THEN 'Submitted'
          WHEN r.version IS NOT NULL THEN 'Draft' ELSE 'Not started' END AS status, p.snapshot->>'name' AS "templateName"
      FROM appraisal_assignments a JOIN appraisal_cycles c ON c.id=a.cycle_id
      JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id
      JOIN appraisal_template_publications p ON p.template_id=a.template_id AND p.version=a.template_version
      LEFT JOIN appraisal_reviews r ON r.cycle_id=a.cycle_id AND r.employee_id=a.employee_id
      WHERE a.reviewer_id=$1 AND c.opened_at IS NOT NULL AND e.status='active' AND u.is_active AND ${scope}
    ), selected AS (
      SELECT * FROM eligible ORDER BY "dueOn","cycleId","employeeId"
      LIMIT $${args.length+1} OFFSET $${args.length+2}
    )
    SELECT (SELECT count(*)::int FROM eligible) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY "dueOn","cycleId","employeeId") FROM selected),'[]'::json) AS items
  `, [...args, req.query.pageSize, pageOffset(req.query)]);
  res.json(pageResult(result.items.map(row => ({ ...row, id: `${row.cycleId}:${row.employeeId}` })), req.query, result.total));
}));

export default router;
