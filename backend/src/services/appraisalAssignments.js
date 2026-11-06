import { coversEmployee } from './accessScope.js';
import { userAccess } from './accessGrants.js';
import { validationError } from './dbErrors.js';
import { HttpError } from '../middleware/error.js';

export function assignmentBody(req, _res, next) {
  const { version, assignments } = req.body ?? {};
  const validId = id => Number.isSafeInteger(id) && id > 0;
  if (!validId(version) || !Array.isArray(assignments) ||
    assignments.some(row => !validId(row?.employeeId) || !validId(row?.reviewerId))) {
    return next(validationError({ assignments: 'Choose an employee and a reviewer for each assignment' }));
  }
  if (new Set(assignments.map(row => row.employeeId)).size !== assignments.length) {
    return next(validationError({ assignments: 'An employee can appear only once per cycle' }));
  }
  req.body = { version, assignments: assignments.map(({ employeeId, reviewerId }) => ({ employeeId, reviewerId })) };
  next();
}

export async function verifyAppraisalAssignments(db, assignments) {
  const employeeIds = assignments.map(row => row.employeeId);
  const reviewerIds = [...new Set(assignments.map(row => row.reviewerId))];
  const { rows: staff } = await db.query(`SELECT e.id,e.user_id,e.department_id,e.employee_code FROM employees e
    JOIN users u ON u.id=e.user_id WHERE e.id=ANY($1::bigint[]) AND e.status='active' AND u.is_active ORDER BY e.id FOR SHARE OF e,u`, [employeeIds]);
  const { rows: reviewers } = await db.query(`SELECT u.id,u.role FROM users u
    LEFT JOIN employees e ON e.user_id=u.id WHERE u.id=ANY($1::bigint[]) AND u.is_active
      AND (e.status='active' OR (e.id IS NULL AND u.role='hr'))`, [reviewerIds]);
  const byEmployee = new Map(staff.map(row => [Number(row.id), row]));
  const byReviewer = new Map();
  for (const reviewer of reviewers) {
    const id = Number(reviewer.id);
    byReviewer.set(id, await userAccess(db, { id, role: reviewer.role }));
  }
  for (const { employeeId, reviewerId } of assignments) {
    const employee = byEmployee.get(employeeId);
    if (!employee) throw validationError({ assignments: `Employee #${employeeId} is unavailable` });
    if (Number(employee.user_id) === reviewerId || !coversEmployee(byReviewer.get(reviewerId), 'appraisals.review', employeeId, employee.department_id)) {
      throw validationError({ assignments: `Choose an eligible reviewer for ${employee.employee_code}` });
    }
  }
}

export async function pinAppraisalTemplates(db, cycleId) {
  const { rows } = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (template_id) template_id,version,snapshot
      FROM appraisal_template_publications ORDER BY template_id,version DESC
    )
    SELECT e.id AS employee_id, e.employee_code, match.template_id, match.version
    FROM appraisal_assignments a JOIN employees e ON e.id=a.employee_id
    LEFT JOIN LATERAL (
      SELECT template_id,version FROM latest
      WHERE snapshot->>'scope'='company'
        OR (snapshot->>'scope'='department' AND snapshot->>'targetId'=e.department_id::text)
        OR (snapshot->>'scope'='position' AND snapshot->>'targetId'=e.position_id::text)
        OR (snapshot->>'scope'='grade' AND snapshot->>'targetId'=e.job_grade_id::text)
      ORDER BY CASE snapshot->>'scope' WHEN 'grade' THEN 3 WHEN 'position' THEN 2 WHEN 'department' THEN 1 ELSE 0 END DESC
      LIMIT 1
    ) match ON TRUE WHERE a.cycle_id=$1
  `, [cycleId]);
  const missing = rows.find(row => row.template_id == null);
  if (missing) throw new HttpError(422, `No published template matches ${missing.employee_code}.`, 'missing_template');
  await db.query(`UPDATE appraisal_assignments a SET template_id=p.template_id,template_version=p.version
    FROM unnest($2::bigint[],$3::bigint[],$4::int[]) p(employee_id,template_id,version)
    WHERE a.cycle_id=$1 AND a.employee_id=p.employee_id`,
  [cycleId, rows.map(row => row.employee_id), rows.map(row => row.template_id), rows.map(row => row.version)]);
}
