import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { validate, v } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { pageSchema } from '../services/sql.js';
import { appraisalReviewIds as ids, loadReviewAssignment, readAppraisalReview, readAppraisalReviewHistory } from '../services/appraisalReviewRecords.js';
import { validationError } from '../services/dbErrors.js';
import { previewAppraisal } from '../../../shared/appraisalPreview.mjs';

const router = Router();
router.use(requirePermission('appraisals.review'));
const path = '/:cycleId/:employeeId';

function reviewBody(req, _res, next) {
  const { version, inputs, comment = '' } = req.body ?? {};
  if (!Number.isSafeInteger(version) || version < 0 || !inputs || typeof inputs !== 'object' || Array.isArray(inputs) ||
      typeof comment !== 'string' || comment.length > 4000) {
    return next(validationError({ inputs: 'Provide valid review inputs and a comment of up to 4,000 characters' }));
  }
  req.body = { version, inputs, comment: comment.trim() };
  next();
}

function cleanInputs(inputs, categories) {
  const allowed = new Set(categories.flatMap(category => category.criteria.map(criterion => criterion.id)));
  return Object.fromEntries(Object.entries(inputs).map(([id, input]) => {
    if (!allowed.has(id) || !input || typeof input !== 'object' || Array.isArray(input)) {
      throw validationError({ inputs: 'Review inputs must belong to the assigned template' });
    }
    const { value = null, notApplicable = false, comment = '' } = input;
    if ((value !== null && typeof value !== 'boolean' && !Number.isFinite(value)) ||
        typeof notApplicable !== 'boolean' || typeof comment !== 'string' || comment.length > 2000) {
      throw validationError({ inputs: 'Enter valid criterion inputs and comments of up to 2,000 characters' });
    }
    return [id, { value: notApplicable ? null : value, notApplicable, comment: comment.trim() }];
  }));
}

router.get(path, validate(ids, 'params'), wrap(async (req, res) => {
  const assignment = await loadReviewAssignment({ query }, req.user, req.params, 'review');
  res.json({ ...assignment, review: await readAppraisalReview({ query }, req.params) });
}));

router.get(path + '/history', validate(ids, 'params'), validate(pageSchema, 'query'), wrap(async (req, res) => {
  await loadReviewAssignment({ query }, req.user, req.params, 'review');
  res.json(await readAppraisalReviewHistory({ query }, req.params, req.query));
}));

function saveReview(submit) {
  return wrap(async (req, res) => {
    const { cycleId, employeeId } = req.params;
    const { version, comment } = req.body;
    const saved = await withTransaction(async db => {
      const { template } = await loadReviewAssignment(db, req.user, req.params, 'review', true);
      const previous = await readAppraisalReview(db, req.params);
      if (previous.submittedAt) throw new HttpError(409, 'This appraisal has already been submitted.', 'conflict');
      if (previous.version !== version) throw new HttpError(409, 'Appraisal changed. Reopen it before saving.', 'conflict');
      const inputs = cleanInputs(req.body.inputs, template.categories);
      const result = previewAppraisal(template.categories, template.brackets, inputs);
      if (result.categories.some(group => group.criteria.some(row => row.result.status === 'invalid'))) {
        throw validationError({ inputs: 'Correct invalid criterion inputs before saving' });
      }
      if (submit && result.status !== 'scored') {
        throw new HttpError(422, 'Complete the required inputs and leave at least one weighted criterion to score.', 'incomplete_review');
      }
      const { rows: [row] } = await db.query(`INSERT INTO appraisal_reviews(cycle_id,employee_id,inputs,comment,result,submitted_at)
        VALUES($1,$2,$3::jsonb,$4,$5::jsonb,CASE WHEN $6 THEN now() ELSE NULL END)
        ON CONFLICT(cycle_id,employee_id) DO UPDATE SET inputs=EXCLUDED.inputs,comment=EXCLUDED.comment,
          result=EXCLUDED.result,submitted_at=EXCLUDED.submitted_at,returned_at=CASE WHEN $6 THEN NULL ELSE appraisal_reviews.returned_at END,version=appraisal_reviews.version+1
        RETURNING version,inputs,comment,result,submitted_at AS "submittedAt",returned_at AS "returnedAt",approved_at AS "approvedAt",NULL::text AS approver`,
      [cycleId, employeeId, JSON.stringify(inputs), comment, submit ? JSON.stringify(result) : null, submit]);
      await audit(db, { actorId: req.user.id, action: submit ? 'appraisal.review.submit' : 'appraisal.review.save',
        entityType: 'appraisal_review', entityId: `${cycleId}:${employeeId}`, details: { cycleId, employeeId, version: row.version } });
      return row;
    });
    res.json(saved);
  });
}

router.put(path, validate(ids, 'params'), reviewBody, saveReview(false));
router.post(path + '/submit', validate(ids, 'params'), reviewBody, saveReview(true));

export default router;
