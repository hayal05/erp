import {approvalWrap as wrap} from '../middleware/approval.js';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { pageOffset, pageResult, setClause } from '../services/sql.js';
import { isFkViolation, translateDbError } from '../services/dbErrors.js';
import { idParams, shiftCreate, shiftListQuery, shiftUpdate } from '../services/hrSchemas.js';

// Shifts are the work schedules (MVP: same-day only, ISO weekdays 1 = Monday .. 7 = Sunday).
const router = Router();
router.use(noStore, requirePermission('organization.manage'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('organization.manage')(req,res,next));

const SELECT = `SELECT s.id, s.name, to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time,
  s.grace_minutes, s.work_days, (SELECT count(*)::int FROM employees e WHERE e.shift_id = s.id) AS employee_count FROM shifts s`;
const toShift = (r) => ({
  id: Number(r.id), name: r.name, startTime: r.start_time, endTime: r.end_time,
  graceMinutes: r.grace_minutes, workDays: r.work_days, employeeCount: r.employee_count,
});
const findShift = async (db, id) => {
  const { rows: [r] } = await db.query(`${SELECT} WHERE s.id = $1`, [id]);
  return r ? toShift(r) : null;
};
const notFound = () => new HttpError(404, 'Shift not found', 'not_found');

router.get('/', validate(shiftListQuery, 'query'), wrap(async (req, res) => {
  const q = req.query;
  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    query(`${SELECT} ORDER BY s.start_time, lower(s.name), s.id LIMIT $1 OFFSET $2`, [q.pageSize, pageOffset(q)]),
    query('SELECT count(*)::int AS n FROM shifts'),
  ]);
  res.json(pageResult(rows.map(toShift), q, total));
}));

router.post('/', validate(shiftCreate), wrap(async (req, res) => {
  const b = req.body;
  const created = await withTransaction(async (db) => {
    const { rows: [row] } = await db.query(
      `INSERT INTO shifts (name, start_time, end_time, grace_minutes, work_days) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [b.name, b.startTime, b.endTime, b.graceMinutes, b.workDays]);
    await audit(db, { actorId: req.user.id, action: 'shift.create', entityType: 'shift', entityId: row.id,
      details: { name: b.name, startTime: b.startTime, endTime: b.endTime, graceMinutes: b.graceMinutes, workDays: b.workDays } });
    return findShift(db, row.id);
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

const COLUMNS = { name: 'name', startTime: 'start_time', endTime: 'end_time', graceMinutes: 'grace_minutes', workDays: 'work_days' };

router.patch('/:id', validate(idParams, 'params'), validate(shiftUpdate), wrap(async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  if (!Object.keys(data).length) throw new HttpError(400, 'No changes supplied', 'validation', { fields: { _: 'Provide at least one field to change' } });

  const updated = await withTransaction(async (db) => {
    await db.query('SELECT 1 FROM shifts WHERE id = $1 FOR UPDATE', [id]);
    const before = await findShift(db, id);
    if (!before) throw notFound();
    const { sets, params } = setClause(COLUMNS, data);
    await db.query(`UPDATE shifts SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]); // end > start is a DB CHECK
    const after = await findShift(db, id);
    const changes = diffFields(before, after, Object.keys(data));
    if (Object.keys(changes).length) {
      await audit(db, { actorId: req.user.id, action: 'shift.update', entityType: 'shift', entityId: id, details: { changes } });
    }
    return after;
  }).catch((err) => { throw translateDbError(err); });
  res.json(updated);
}));

router.delete('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const { id } = req.params;
  await withTransaction(async (db) => {
    const cur = await findShift(db, id);
    if (!cur) throw notFound();
    try {
      await db.query('DELETE FROM shifts WHERE id = $1', [id]);
    } catch (err) {
      if (isFkViolation(err)) throw new HttpError(409, 'Shift is assigned to employees. Reassign them first.', 'in_use');
      throw err;
    }
    await audit(db, { actorId: req.user.id, action: 'shift.delete', entityType: 'shift', entityId: id, details: { name: cur.name } });
  });
  res.sendStatus(204);
}));

export default router;
