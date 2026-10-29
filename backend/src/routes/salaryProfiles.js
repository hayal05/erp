import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../services/hrSchemas.js';
import { validationError } from '../services/dbErrors.js';
import { loadSalaryProfile, parseSalaryProfile, saveSalaryProfile } from '../services/salaryProfiles.js';
const router = Router();
router.use(noStore, requireHr);
router.get('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const id = req.params.id;
  if (!(await query('SELECT 1 FROM employees WHERE id = $1', [id])).rowCount) throw new HttpError(404, 'Employee not found', 'not_found');
  res.json(await loadSalaryProfile({ query }, id));
}));
// PUT replaces the profile; the shared saveSalaryProfile locks the employee row, skips unchanged saves and audits.
router.put('/:id', validate(idParams, 'params'), (req, res, next) => {
  const result = parseSalaryProfile(req.body);
  if (result.errors) return next(validationError(result.errors));
  req.body = result.value; next();
}, wrap(async (req, res) => {
  res.json(await withTransaction((db) => saveSalaryProfile(db, { employeeId: req.params.id, actorId: req.user.id, values: req.body })));
}));
export default router;
