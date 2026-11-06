import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireEmployee } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../services/hrSchemas.js';
import { pageOffset, pageResult, pageSchema } from '../services/sql.js';
import { reviewColumns } from '../services/appraisalReviewRecords.js';

const router = Router();
router.use(noStore, requireEmployee);
const ownResults = `FROM appraisal_reviews r JOIN employees e ON e.id=r.employee_id
  JOIN appraisal_assignments a USING (cycle_id,employee_id)
  JOIN appraisal_cycles c ON c.id=r.cycle_id
  JOIN appraisal_template_publications p ON p.template_id=a.template_id AND p.version=a.template_version
  WHERE e.user_id=$1 AND r.approved_at IS NOT NULL`;

router.get('/', validate(pageSchema, 'query'), wrap(async (req, res) => {
  const { rows: [result] } = await query(`WITH selected AS (
    SELECT c.id,c.name AS cycle,r.approved_at AS "approvedAt",r.result->'rating' AS rating
    ${ownResults} ORDER BY r.approved_at DESC,c.id DESC LIMIT $2 OFFSET $3
  ) SELECT (SELECT count(*)::int ${ownResults}) AS total,
    COALESCE((SELECT json_agg(selected ORDER BY "approvedAt" DESC,id DESC) FROM selected),'[]'::json) AS items`,
  [req.user.id, req.query.pageSize, pageOffset(req.query)]);
  res.json(pageResult(result.items, req.query, result.total));
}));

router.get('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const { rows: [result] } = await query(`SELECT c.id,c.name AS cycle,p.snapshot AS template,${reviewColumns}
    ${ownResults} AND c.id=$2`, [req.user.id, req.params.id]);
  if (!result) throw new HttpError(404, 'Appraisal result not found', 'not_found');
  res.json(result);
}));
export default router;
