import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { validate, v } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { scopeSql } from '../services/accessScope.js';
import { validationError } from '../services/dbErrors.js';
import { previewAppraisal } from '../../../shared/appraisalPreview.mjs';

const router = Router();
router.use(requirePermission('appraisals.review'));
const ids = { cycleId: v.int({ required: true, min: 1 }), employeeId: v.int({ required: true, min: 1 }) };
const path = '/:cycleId/:employeeId';

async function loadAssignment(db, user, { cycleId, employeeId }, lock = false) {
  const args = [cycleId, employeeId, user.id];
  const scope = scopeSql(user, 'appraisals.review', 'e', args);
  const { rows: [row] } = await db.query(`
    SELECT c.name AS cycle, to_char(c.due_on,'YYYY-MM-DD') AS "dueOn",
      u.full_name AS employee, e.employee_code AS "employeeCode", p.snapshot AS template
    FROM appraisal_assignments a JOIN appraisal_cycles c ON c.id=a.cycle_id
    JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id
    JOIN appraisal_template_publications p ON p.template_id=a.template_id AND p.version=a.template_version
    WHERE a.cycle_id=$1 AND a.employee_id=$2 AND a.reviewer_id=$3
      AND c.opened_at IS NOT NULL AND e.status='active' AND u.is_active AND ${scope}
    ${lock ? 'FOR UPDATE OF a FOR SHARE OF e,u' : ''}
  `, args);
  if (!row) throw new HttpError(404, 'Appraisal assignment not found', 'not_found');
  return row;
}

async function readReview(db, { cycleId, employeeId }) {
  const { rows: [row] } = await db.query(`SELECT version,inputs,comment,result,submitted_at AS "submittedAt"
    FROM appraisal_reviews WHERE cycle_id=$1 AND employee_id=$2`, [cycleId, employeeId]);
  return row ?? { version: 0, inputs: {}, comment: '', result: null, submittedAt: null };
}

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
  const assignment = await loadAssignment({ query }, req.user, req.params);
  res.json({ ...assignment, review: await readReview({ query }, req.params) });
}));

function saveReview(submit) {
  return wrap(async (req, res) => {
    const { cycleId, employeeId } = req.params;
    const { version, comment } = req.body;
    const saved = await withTransaction(async db => {
      const { template } = await loadAssignment(db, req.user, req.params, true);
      const previous = await readReview(db, req.params);
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
          result=EXCLUDED.result,submitted_at=EXCLUDED.submitted_at,version=appraisal_reviews.version+1
        RETURNING version,inputs,comment,result,submitted_at AS "submittedAt"`,
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
