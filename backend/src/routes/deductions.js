import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { validationError, translateDbError } from '../services/dbErrors.js';
import { setClause } from '../services/sql.js';
import { idParams } from '../services/hrSchemas.js';
import { toDeduction, assertNotConsumed } from '../services/deductions.js';
import { parseDeductionCreate, parseDeductionUpdate, deductionListQuery } from '../services/payrollSchemas.js';

// Flat per-employee deductions for HR (spec 16), mounted at /api/deductions. Task 4.8a: CRUD only; one-time consumption and the
// engine hookup are 4.8b. Amounts are whole minor units. Items are settings for FUTURE payrolls: an approved payroll keeps its own
// copy of the breakdown (payroll_entry_items has no foreign key here), so editing or deleting an item never alters history.
const router = Router();
router.use(noStore, requirePermission('deductions.read'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('deductions.manage')(req,res,next));

const findItem = async (db, id, { lock = false } = {}) => {
  const { rows: [r] } = await db.query(`SELECT * FROM deduction_items WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return r ? toDeduction(r) : null;
};
const itemNotFound = () => new HttpError(404, 'Deduction item not found', 'not_found');
const parsed = (parser) => (req, res, next) => {
  const { value, errors } = parser(req.body);
  if (errors) return next(validationError(errors));
  req.body = value;
  next();
};
const COLUMNS = { kind: 'kind', name: 'name', amountMinor: 'amount_minor', recurring: 'recurring', enabled: 'enabled' };

// GET /?employeeId= -> { items } for that employee, oldest first. employeeId is required (there is no all-employees list); an
// unknown employee is 404 so the UI can tell "no items" from "wrong person".
router.get('/', validate(deductionListQuery, 'query'), wrap(async (req, res) => {
  const { employeeId } = req.query;
  if (!(await query('SELECT 1 FROM employees WHERE id = $1', [employeeId])).rowCount) throw new HttpError(404, 'Employee not found', 'not_found');
  const { rows } = await query('SELECT * FROM deduction_items WHERE employee_id = $1 ORDER BY id', [employeeId]);
  res.json({ items: rows.map(toDeduction) });
}));

// POST / { employeeId, kind, name, amountMinor, recurring?, enabled? } -> 201 the new item. Unknown employee: 400 on employeeId.
router.post('/', parsed(parseDeductionCreate), wrap(async (req, res) => {
  const { employeeId, kind, name, amountMinor, recurring, enabled } = req.body;
  const created = await withTransaction(async (db) => {
    const { rows: [row] } = await db.query(
      'INSERT INTO deduction_items (employee_id, kind, name, amount_minor, recurring, enabled) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [employeeId, kind, name, amountMinor, recurring, enabled]);
    const item = await findItem(db, row.id);
    await audit(db, { actorId: req.user.id, action: 'payroll.deduction.create', entityType: 'deduction_item', entityId: item.id,
      details: { employeeId, kind, name, amountMinor, recurring, enabled } });
    return item;
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

// PATCH /:id { kind?, name?, amountMinor?, recurring?, enabled? } -> the saved item. Omitted = unchanged (employeeId is ignored: an
// item never moves to another person). A request that changes nothing returns 200 and writes no audit row. `enabled: false` pauses
// an item without losing it.
router.patch('/:id', validate(idParams, 'params'), parsed(parseDeductionUpdate), wrap(async (req, res) => {
  const { id } = req.params, data = req.body;
  const saved = await withTransaction(async (db) => {
    const before = await findItem(db, id, { lock: true });
    if (!before) throw itemNotFound();
    assertNotConsumed(before); // 4.8b-4: before the diff, so even a no-op PATCH of a consumed item is refused
    const changes = diffFields(before, { ...before, ...data }, Object.keys(data));
    const keys = Object.keys(changes);
    if (keys.length === 0) return before;
    const { sets, params } = setClause(COLUMNS, Object.fromEntries(keys.map((k) => [k, data[k]])));
    await db.query(`UPDATE deduction_items SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]);
    await audit(db, { actorId: req.user.id, action: 'payroll.deduction.update', entityType: 'deduction_item', entityId: id,
      details: { employeeId: before.employeeId, name: before.name, changes } });
    return findItem(db, id);
  }).catch((err) => { throw translateDbError(err); });
  res.json(saved);
}));

// DELETE /:id -> 204, audited with the values it had. An item already used by a payroll is refused with 409 `conflict`.
router.delete('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  await withTransaction(async (db) => {
    const cur = await findItem(db, req.params.id, { lock: true });
    if (!cur) throw itemNotFound();
    assertNotConsumed(cur); // 4.8b-5: a one-time item a payroll already used stays, so history keeps its source
    await db.query('DELETE FROM deduction_items WHERE id = $1', [req.params.id]);
    await audit(db, { actorId: req.user.id, action: 'payroll.deduction.delete', entityType: 'deduction_item', entityId: req.params.id,
      details: { employeeId: cur.employeeId, kind: cur.kind, name: cur.name, amountMinor: cur.amountMinor, recurring: cur.recurring, enabled: cur.enabled } });
  });
  res.sendStatus(204);
}));

export default router;
