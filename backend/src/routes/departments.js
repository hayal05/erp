import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { likePattern, pageOffset, pageResult } from '../services/sql.js';
import { isFkViolation, translateDbError } from '../services/dbErrors.js';
import { departmentBody, departmentListQuery, idParams } from '../services/hrSchemas.js';
import { departmentPositions } from './positions.js';

const router = Router();
router.use(noStore, requireHr);
router.use('/:id/positions', departmentPositions); // list + create positions of one department (task 6.3)

const toDepartment = (r) => ({ id: Number(r.id), name: r.name, employeeCount: r.employee_count, positionCount: r.position_count });
// One column list for the list, the detail and every write response, so they always carry the same counts (task 6.4).
const SELECT = `SELECT d.id, d.name, (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id) AS employee_count,
  (SELECT count(*)::int FROM positions p WHERE p.department_id = d.id) AS position_count FROM departments d`;
async function findDepartment(db, id) {
  const { rows: [r] } = await db.query(`${SELECT} WHERE d.id = $1`, [id]);
  return r ? toDepartment(r) : null;
}
const notFound = () => new HttpError(404, 'Department not found', 'not_found');

router.get('/', validate(departmentListQuery, 'query'), wrap(async (req, res) => {
  const q = req.query;
  const params = q.search ? [likePattern(q.search)] : [];
  const where = q.search ? `WHERE d.name ILIKE $1 ESCAPE '\\'` : '';
  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    query(`${SELECT} ${where} ORDER BY lower(d.name), d.id
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n FROM departments d ${where}`, params),
  ]);
  res.json(pageResult(rows.map(toDepartment), q, total));
}));

// Detail: the department page (task 6.9) needs the name and counts of one department.
router.get('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const found = await findDepartment({ query }, req.params.id);
  if (!found) throw notFound();
  res.json(found);
}));

router.post('/', validate(departmentBody), wrap(async (req, res) => {
  const created = await withTransaction(async (db) => {
    const { rows: [row] } = await db.query('INSERT INTO departments (name) VALUES ($1) RETURNING id', [req.body.name]);
    await audit(db, { actorId: req.user.id, action: 'department.create', entityType: 'department', entityId: row.id, details: { name: req.body.name } });
    return findDepartment(db, row.id);
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

router.patch('/:id', validate(idParams, 'params'), validate(departmentBody), wrap(async (req, res) => {
  const { id } = req.params;
  const updated = await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query('SELECT name FROM departments WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound();
    if (cur.name !== req.body.name) {
      await db.query('UPDATE departments SET name = $2 WHERE id = $1', [id, req.body.name]);
      await audit(db, { actorId: req.user.id, action: 'department.update', entityType: 'department', entityId: id,
        details: { changes: { name: { from: cur.name, to: req.body.name } } } });
    }
    return findDepartment(db, id);
  }).catch((err) => { throw translateDbError(err); });
  res.json(updated);
}));

// Departments hold no history of their own, so an unused one can be removed. Positions are checked first, so the message
// names the real blocker; the foreign key (ON DELETE RESTRICT) then refuses while any employee, active or not, still belongs to it.
// The department row is locked FOR UPDATE here and creating a position takes FOR SHARE on it, so a position cannot appear mid-delete.
router.delete('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const { id } = req.params;
  await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query('SELECT name FROM departments WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound();
    if ((await db.query('SELECT 1 FROM positions WHERE department_id = $1 LIMIT 1', [id])).rowCount) {
      throw new HttpError(409, 'Department still has positions. Delete its positions first.', 'in_use');
    }
    try {
      await db.query('DELETE FROM departments WHERE id = $1', [id]);
    } catch (err) {
      if (isFkViolation(err)) throw new HttpError(409, 'Department still has employees. Move them first.', 'in_use');
      throw err;
    }
    await audit(db, { actorId: req.user.id, action: 'department.delete', entityType: 'department', entityId: id, details: { name: cur.name } });
  });
  res.sendStatus(204);
}));

export default router;
