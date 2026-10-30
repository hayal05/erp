import {approvalWrap as wrap} from '../middleware/approval.js';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { likePattern, pageOffset, pageResult } from '../services/sql.js';
import { isFkViolation, translateDbError, validationError } from '../services/dbErrors.js';
import { idParams, positionListQuery } from '../services/hrSchemas.js';
import { POSITION_COLUMNS, parsePosition, toPosition } from '../services/positions.js';

// Positions (task 6.3). Two routers share this file: `departmentPositions` is mounted by routes/departments.js at
// /api/departments/:id/positions (list + create, the department comes from the URL), and the default export is mounted
// at /api/positions (edit + delete by id). Both sit behind HR-only guards; a locked tablet session is refused by lockGate.
// A position is a template: nothing here changes any employee's salary (task 6.5 copies a package at assignment time).
const SELECT = `SELECT p.id, p.department_id, p.name, p.basic_minor, p.allowance_minor, p.allowance_taxable, p.allowance_pensionable,
  p.pension_applies, (SELECT count(*)::int FROM employees e WHERE e.position_id = p.id) AS employee_count FROM positions p`;
async function findPosition(db, id) {
  const { rows: [r] } = await db.query(`${SELECT} WHERE p.id = $1`, [id]);
  return r ? toPosition(r) : null;
}
const notFound = () => new HttpError(404, 'Position not found', 'not_found');
const noDepartment = () => new HttpError(404, 'Department not found', 'not_found');

// Validates the body with the shared salary rules and replaces req.body with the cleaned copy (like PUT /salary-profiles).
function positionBody(req, res, next) {
  const result = parsePosition(req.body);
  if (result.errors) return next(validationError(result.errors));
  req.body = result.value;
  next();
}

// ---- /api/departments/:id/positions
export const departmentPositions = Router({ mergeParams: true });
departmentPositions.use(noStore, requirePermission('organization.read'));
departmentPositions.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('organization.manage')(req,res,next));

departmentPositions.get('/', validate(idParams, 'params'), validate(positionListQuery, 'query'), wrap(async (req, res) => {
  const { id } = req.params;
  const q = req.query;
  if (!(await query('SELECT 1 FROM departments WHERE id = $1', [id])).rowCount) throw noDepartment();
  const params = q.search ? [id, likePattern(q.search)] : [id];
  const where = q.search ? `WHERE p.department_id = $1 AND p.name ILIKE $2 ESCAPE '\\'` : 'WHERE p.department_id = $1';
  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    query(`${SELECT} ${where} ORDER BY lower(p.name), p.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n FROM positions p ${where}`, params),
  ]);
  res.json(pageResult(rows.map(toPosition), q, total));
}));

departmentPositions.post('/', validate(idParams, 'params'), positionBody, wrap(async (req, res) => {
  const { id } = req.params;
  const b = req.body;
  const created = await withTransaction(async (db) => {
    // FOR SHARE: a concurrent department delete waits for this transaction instead of orphaning the new position.
    if (!(await db.query('SELECT 1 FROM departments WHERE id = $1 FOR SHARE', [id])).rowCount) throw noDepartment();
    const cols = Object.values(POSITION_COLUMNS);
    const { rows: [row] } = await db.query(
      `INSERT INTO positions (department_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
      [id, ...Object.keys(POSITION_COLUMNS).map((key) => b[key])]);
    await audit(db, { actorId: req.user.id, action: 'position.create', entityType: 'position', entityId: row.id, details: { departmentId: Number(id), ...b } });
    return findPosition(db, row.id);
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

// ---- /api/positions
const router = Router();
router.use(noStore, requirePermission('organization.read'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('organization.manage')(req,res,next));

// Full replacement of the editable fields (name + the five salary fields). The department never changes here.
router.patch('/:id', validate(idParams, 'params'), positionBody, wrap(async (req, res) => {
  const { id } = req.params;
  const updated = await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query(`${SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [id]);
    if (!cur) throw notFound();
    const before = toPosition(cur);
    const changes = diffFields(before, req.body, Object.keys(POSITION_COLUMNS));
    if (Object.keys(changes).length) {
      await db.query(`UPDATE positions SET ${Object.values(POSITION_COLUMNS).map((col, i) => `${col} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...Object.keys(POSITION_COLUMNS).map((key) => req.body[key])]);
      // Employees on this position keep their salary (it was copied once) but their job title follows the position's name.
      let titlesUpdated = 0;
      if (changes.name) {
        titlesUpdated = (await db.query('UPDATE employees SET job_title = $2 WHERE position_id = $1', [id, req.body.name])).rowCount;
      }
      await audit(db, { actorId: req.user.id, action: 'position.update', entityType: 'position', entityId: id,
        details: { departmentId: before.departmentId, changes, ...(changes.name ? { jobTitlesUpdated: titlesUpdated } : {}) } });
    }
    return findPosition(db, id);
  }).catch((err) => { throw translateDbError(err); });
  res.json(updated);
}));

// A position nobody holds can be removed; the foreign key (ON DELETE RESTRICT) refuses while any employee,
// active or not, is still on it.
router.delete('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const { id } = req.params;
  await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query('SELECT name, department_id FROM positions WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound();
    try {
      await db.query('DELETE FROM positions WHERE id = $1', [id]);
    } catch (err) {
      if (isFkViolation(err)) throw new HttpError(409, 'Position is still assigned to employees. Move them first.', 'in_use');
      throw err;
    }
    await audit(db, { actorId: req.user.id, action: 'position.delete', entityType: 'position', entityId: id, details: { departmentId: Number(cur.department_id), name: cur.name } });
  });
  res.sendStatus(204);
}));

export default router;
