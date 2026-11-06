import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { validate, v } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { scopeSql } from '../services/accessScope.js';
import { pageSchema, pageOffset, pageResult } from '../services/sql.js';
import { appraisalReviewIds as ids, loadReviewAssignment, readAppraisalReview, readAppraisalReviewHistory } from '../services/appraisalReviewRecords.js';

const router = Router();
router.use(requirePermission('appraisals.approve'));
const path = '/:cycleId/:employeeId';

router.get('/', validate({ ...pageSchema, status: v.enum({ values: ['submitted','approved'], default: 'submitted' }) }, 'query'),
  wrap(async (req, res) => {
    const args = [req.user.id, req.query.status === 'approved'];
    const scope = scopeSql(req.user, 'appraisals.approve', 'e', args);
    const { rows: [result] } = await query(`WITH eligible AS (
      SELECT a.cycle_id AS "cycleId", a.employee_id AS "employeeId", c.name AS cycle,
        u.full_name AS employee, reviewer.full_name AS reviewer, r.submitted_at AS "submittedAt",
        r.approved_at AS "approvedAt"
      FROM appraisal_reviews r JOIN appraisal_assignments a USING (cycle_id,employee_id)
      JOIN appraisal_cycles c ON c.id=a.cycle_id JOIN employees e ON e.id=a.employee_id
      JOIN users u ON u.id=e.user_id JOIN users reviewer ON reviewer.id=a.reviewer_id
      WHERE c.opened_at IS NOT NULL AND r.submitted_at IS NOT NULL AND (r.approved_at IS NOT NULL)=$2
        AND a.reviewer_id<>$1 AND e.user_id<>$1 AND ${scope}
    ), selected AS (
      SELECT * FROM eligible ORDER BY "submittedAt" DESC,"cycleId","employeeId"
      LIMIT $${args.length+1} OFFSET $${args.length+2}
    )
    SELECT (SELECT count(*)::int FROM eligible) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY "submittedAt" DESC,"cycleId","employeeId") FROM selected),'[]'::json) AS items
    `, [...args, req.query.pageSize, pageOffset(req.query)]);
    res.json(pageResult(result.items.map(row => ({ ...row, id: `${row.cycleId}:${row.employeeId}` })), req.query, result.total));
  }));

router.get(path, validate(ids, 'params'), wrap(async (req, res) => {
  const result = await withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const assignment = await loadReviewAssignment(db, req.user, req.params, 'approve');
    return { ...assignment, review: await readAppraisalReview(db, req.params) };
  });
  res.json(result);
}));
router.get(path + '/history', validate(ids, 'params'), validate(pageSchema, 'query'), wrap(async (req, res) => {
  await loadReviewAssignment({ query }, req.user, req.params, 'approve');
  res.json(await readAppraisalReviewHistory({ query }, req.params, req.query));
}));

router.post(path + '/decision', validate(ids, 'params'), validate({
  version: v.int({ required: true, min: 1 }), decision: v.enum({ required: true, values: ['approve', 'return'] }),
  reason: v.string({ max: 1000, default: '' }),
}), wrap(async (req, res) => {
  const { cycleId, employeeId } = req.params;
  const { decision, reason, version } = req.body;
  const approve = decision === 'approve';
  if (!approve && !reason) throw new HttpError(400, 'Enter a reason for returning this appraisal.', 'validation');
  const review = await withTransaction(async db => {
    await loadReviewAssignment(db, req.user, req.params, 'approve', true);
    const previous = await readAppraisalReview(db, req.params);
    if (!previous.submittedAt || previous.approvedAt || previous.version !== version) {
      throw new HttpError(409, 'Appraisal changed. Reopen it before deciding.', 'conflict');
    }
    if (approve) {
      await db.query(`UPDATE appraisal_reviews SET approved_at=now(),approved_by=$3,version=version+1
        WHERE cycle_id=$1 AND employee_id=$2`, [cycleId, employeeId, req.user.id]);
    } else {
      await db.query(`UPDATE appraisal_reviews SET submitted_at=NULL,result=NULL,returned_at=now(),version=version+1
        WHERE cycle_id=$1 AND employee_id=$2`, [cycleId, employeeId]);
    }
    await audit(db, { actorId: req.user.id, action: `appraisal.review.${decision}`, entityType: 'appraisal_review',
      entityId: `${cycleId}:${employeeId}`, reason: reason || null, details: { cycleId, employeeId, version: previous.version + 1 } });
    return readAppraisalReview(db, req.params);
  });
  res.json(review);
}));

export default router;
