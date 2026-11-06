import { HttpError } from '../middleware/error.js';
import { v } from '../middleware/validate.js';
import { scopeSql } from './accessScope.js';
import { pageOffset, pageResult } from './sql.js';

export const appraisalReviewIds = { cycleId: v.int({ required: true, min: 1 }), employeeId: v.int({ required: true, min: 1 }) };

export const reviewColumns = `r.version,r.inputs,r.comment,r.result,r.submitted_at AS "submittedAt",
  r.returned_at AS "returnedAt",r.approved_at AS "approvedAt"`;

export async function loadReviewAssignment(db, user, { cycleId, employeeId }, mode, lock = false) {
  const args = [cycleId, employeeId, user.id];
  const scope = scopeSql(user, mode === 'review' ? 'appraisals.review' : 'appraisals.approve', 'e', args);
  const visibility = mode === 'review'
    ? "a.reviewer_id=$3 AND e.status='active' AND u.is_active"
    : 'a.reviewer_id<>$3 AND e.user_id<>$3 AND EXISTS(SELECT 1 FROM appraisal_reviews r WHERE r.cycle_id=a.cycle_id AND r.employee_id=a.employee_id AND r.submitted_at IS NOT NULL)';
  const { rows: [row] } = await db.query(`
    SELECT c.name AS cycle, to_char(c.due_on,'YYYY-MM-DD') AS "dueOn",
      u.full_name AS employee, e.employee_code AS "employeeCode", reviewer.full_name AS reviewer, p.snapshot AS template
    FROM appraisal_assignments a JOIN appraisal_cycles c ON c.id=a.cycle_id
    JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id
    JOIN users reviewer ON reviewer.id=a.reviewer_id
    JOIN appraisal_template_publications p ON p.template_id=a.template_id AND p.version=a.template_version
    WHERE a.cycle_id=$1 AND a.employee_id=$2 AND c.opened_at IS NOT NULL AND ${visibility} AND ${scope}
    ${lock ? 'FOR UPDATE OF a FOR SHARE OF e,u' : ''}
  `, args);
  if (!row) throw new HttpError(404, 'Appraisal assignment not found', 'not_found');
  return row;
}

export async function readAppraisalReview(db, { cycleId, employeeId }) {
  const { rows: [row] } = await db.query(`SELECT ${reviewColumns},approver.full_name AS approver
    FROM appraisal_reviews r LEFT JOIN users approver ON approver.id=r.approved_by
    WHERE r.cycle_id=$1 AND r.employee_id=$2`, [cycleId, employeeId]);
  return row ?? { version: 0, inputs: {}, comment: '', result: null, submittedAt: null, approvedAt: null, returnedAt: null };
}

export async function readAppraisalReviewHistory(db, { cycleId, employeeId }, filters) {
  const { rows: [result] } = await db.query(`
    WITH events AS (
      SELECT a.id,a.action,a.occurred_at AS at,u.full_name AS actor,a.reason
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
      WHERE a.entity_type='appraisal_review' AND a.entity_id=$1
    ), selected AS (SELECT * FROM events ORDER BY at DESC,id DESC LIMIT $2 OFFSET $3)
    SELECT (SELECT count(*)::int FROM events) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY at DESC,id DESC) FROM selected),'[]'::json) AS items
  `, [`${cycleId}:${employeeId}`, filters.pageSize, pageOffset(filters)]);
  return pageResult(result.items, filters, result.total);
}
