import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { approvalWrap } from '../middleware/approval.js';
import { validate, v } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { idParams } from '../services/hrSchemas.js';
import { likePattern, pageOffset, pageResult, pageSchema } from '../services/sql.js';
import { assignmentBody, pinAppraisalTemplates, verifyAppraisalAssignments } from '../services/appraisalAssignments.js';

const router = Router();
router.use(requirePermission('appraisals.configure'));
const fields = {
  name: v.string({ required: true, max: 120 }), kind: v.enum({ required: true, values: ['quarterly','annual','custom'] }),
  startsOn: v.date({ required: true }), endsOn: v.date({ required: true }), dueOn: v.date({ required: true }),
};
const versionRule = v.int({ required: true, min: 1 });
const cycleColumns = `id,name,kind,version,opened_at AS "openedAt",to_char(starts_on,'YYYY-MM-DD') AS "startsOn",
  to_char(ends_on,'YYYY-MM-DD') AS "endsOn",to_char(due_on,'YYYY-MM-DD') AS "dueOn"`;

async function draftCycle(db, id, version) {
  const { rows: [row] } = await db.query('SELECT version,opened_at FROM appraisal_cycles WHERE id=$1 FOR UPDATE', [id]);
  if (!row) throw new HttpError(404, 'Appraisal cycle not found', 'not_found');
  if (row.opened_at) throw new HttpError(409, 'This cycle is already open.', 'conflict');
  if (row.version !== version) throw new HttpError(409, 'Cycle changed. Reopen it before saving.', 'conflict');
}

router.get('/', validate(pageSchema, 'query'), wrap(async (req, res) => {
  const { rows: [result] } = await query(`WITH selected AS (
    SELECT ${cycleColumns} FROM appraisal_cycles ORDER BY id DESC LIMIT $1 OFFSET $2
  ) SELECT (SELECT count(*)::int FROM appraisal_cycles) AS total,
    COALESCE((SELECT json_agg(selected ORDER BY id DESC) FROM selected),'[]'::json) AS items`,
  [req.query.pageSize, pageOffset(req.query)]);
  res.json(pageResult(result.items, req.query, result.total));
}));

router.get('/reviewers', validate({ ...pageSchema, search: v.string({ max: 120 }) }, 'query'), wrap(async (req, res) => {
  const { rows: [result] } = await query(`WITH eligible AS (
    SELECT u.id,u.full_name AS name FROM users u LEFT JOIN employees e ON e.user_id=u.id
    WHERE u.is_active AND (e.status='active' OR (e.id IS NULL AND u.role='hr')) AND u.full_name ILIKE $1
      AND (EXISTS(SELECT 1 FROM access_grants a WHERE a.user_id=u.id AND a.revoked_at IS NULL AND a.access_role IN ('admin','hr'))
        OR EXISTS(SELECT 1 FROM custom_access_grants g JOIN custom_access_roles r ON r.id=g.role_id
          WHERE g.user_id=u.id AND g.revoked_at IS NULL AND 'appraisals.review'=ANY(r.permissions)))
  ), selected AS (SELECT * FROM eligible ORDER BY lower(name),id LIMIT $2 OFFSET $3)
  SELECT (SELECT count(*)::int FROM eligible) AS total,
    COALESCE((SELECT json_agg(selected ORDER BY lower(name),id) FROM selected),'[]'::json) AS items`,
  [likePattern(req.query.search ?? ''), req.query.pageSize, pageOffset(req.query)]);
  res.json(pageResult(result.items, req.query, result.total));
}));

router.get('/:id/assignments', validate(idParams, 'params'), wrap(async (req, res) => {
  const { rows: [cycle] } = await query(`SELECT ${cycleColumns} FROM appraisal_cycles WHERE id=$1`, [req.params.id]);
  if (!cycle) throw new HttpError(404, 'Appraisal cycle not found', 'not_found');
  const { rows } = await query(`SELECT a.employee_id AS "employeeId", a.reviewer_id AS "reviewerId",
    u.full_name AS employee, r.full_name AS reviewer, a.template_version AS "templateVersion", p.snapshot->>'name' AS "templateName"
    FROM appraisal_assignments a JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id
    JOIN users r ON r.id=a.reviewer_id LEFT JOIN appraisal_template_publications p ON p.template_id=a.template_id AND p.version=a.template_version
    WHERE a.cycle_id=$1 ORDER BY lower(u.full_name),e.id`, [req.params.id]);
  res.json({ cycle: { ...cycle, id: Number(cycle.id) }, items: rows.map(row => ({
    ...row, employeeId: Number(row.employeeId), reviewerId: Number(row.reviewerId),
  })) });
}));

function saveCycle(edit) {
  return approvalWrap(async (req, res) => {
    const { id } = req.params;
    const { name, kind, startsOn, endsOn, dueOn, version } = req.body;
    const saved = await withTransaction(async db => {
      if (edit) await draftCycle(db, id, version);
      const args = [name, kind, startsOn, endsOn, dueOn];
      const { rows: [row] } = edit
        ? await db.query(`UPDATE appraisal_cycles SET name=$1,kind=$2,starts_on=$3,ends_on=$4,due_on=$5,version=version+1
          WHERE id=$6 RETURNING ${cycleColumns}`, [...args, id])
        : await db.query(`INSERT INTO appraisal_cycles(name,kind,starts_on,ends_on,due_on) VALUES($1,$2,$3,$4,$5)
          RETURNING ${cycleColumns}`, args);
      await audit(db, { actorId: req.user.id, action: edit ? 'appraisal.cycle.update' : 'appraisal.cycle.create',
        entityType: 'appraisal_cycle', entityId: row.id, details: { name, kind, startsOn, endsOn, dueOn } });
      return row;
    });
    res.status(edit ? 200 : 201).json(saved);
  });
}
function dateOrder(req, _res, next) {
  const { startsOn, endsOn, dueOn } = req.body;
  if (startsOn > endsOn || endsOn > dueOn) return next(new HttpError(400, 'Dates must be in start, end, and deadline order.', 'validation'));
  next();
}
router.post('/', validate(fields), dateOrder, saveCycle(false));
router.put('/:id', validate(idParams, 'params'), validate({ ...fields, version: versionRule }), dateOrder, saveCycle(true));

router.put('/:id/assignments', validate(idParams, 'params'), assignmentBody, approvalWrap(async (req, res) => {
  const { id } = req.params;
  const { version, assignments } = req.body;
  await withTransaction(async db => {
    await draftCycle(db, id, version);
    await verifyAppraisalAssignments(db, assignments);
    await db.query('DELETE FROM appraisal_assignments WHERE cycle_id=$1', [id]);
    await db.query(`INSERT INTO appraisal_assignments(cycle_id,employee_id,reviewer_id)
      SELECT $1,employee_id,reviewer_id FROM unnest($2::bigint[],$3::bigint[]) a(employee_id,reviewer_id)`,
    [id, assignments.map(row => row.employeeId), assignments.map(row => row.reviewerId)]);
    await db.query('UPDATE appraisal_cycles SET version=version+1 WHERE id=$1', [id]);
    await audit(db, { actorId: req.user.id, action: 'appraisal.cycle.assignments.update',
      entityType: 'appraisal_cycle', entityId: id, details: { count: assignments.length } });
  });
  res.sendStatus(204);
}));

router.post('/:id/open', validate(idParams, 'params'), validate({ version: versionRule }), approvalWrap(async (req, res) => {
  const { id } = req.params;
  const saved = await withTransaction(async db => {
    await draftCycle(db, id, req.body.version);
    const { rows } = await db.query('SELECT employee_id,reviewer_id FROM appraisal_assignments WHERE cycle_id=$1', [id]);
    if (!rows.length) throw new HttpError(422, 'Assign at least one employee before opening the cycle.', 'empty_cycle');
    await verifyAppraisalAssignments(db, rows.map(row => ({ employeeId: Number(row.employee_id), reviewerId: Number(row.reviewer_id) })));
    await pinAppraisalTemplates(db, id);
    const { rows: [cycle] } = await db.query(`UPDATE appraisal_cycles SET opened_at=now(),version=version+1
      WHERE id=$1 RETURNING ${cycleColumns}`, [id]);
    await audit(db, { actorId: req.user.id, action: 'appraisal.cycle.open', entityType: 'appraisal_cycle',
      entityId: id, details: { count: rows.length } });
    return cycle;
  });
  res.json(saved);
}));
export default router;
