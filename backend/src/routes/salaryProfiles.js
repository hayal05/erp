import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../services/hrSchemas.js';
import { validationError } from '../services/dbErrors.js';
import { audit, diffFields } from '../services/audit.js';
import { PROFILE_COLUMNS, parseSalaryProfile, toSalaryProfile } from '../services/salaryProfiles.js';
const router = Router();
router.use(noStore, requireHr);
const missing = () => new HttpError(404, 'Employee not found', 'not_found');
const load = async (db, id) => toSalaryProfile((await db.query('SELECT * FROM salary_profiles WHERE employee_id = $1', [id])).rows[0], id);
router.get('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const id = req.params.id;
  if (!(await query('SELECT 1 FROM employees WHERE id = $1', [id])).rowCount) throw missing();
  res.json(await load({ query }, id));
}));
// PUT replaces the profile; an employee row lock serializes first-time saves as well as edits.
router.put('/:id', validate(idParams, 'params'), (req, res, next) => {
  const result = parseSalaryProfile(req.body);
  if (result.errors) return next(validationError(result.errors));
  req.body = result.value; next();
}, wrap(async (req, res) => {
  const id = req.params.id;
  const saved = await withTransaction(async (db) => {
    if (!(await db.query('SELECT 1 FROM employees WHERE id = $1 FOR UPDATE', [id])).rowCount) throw missing();
    const before = await load(db, id);
    const changes = diffFields(before, req.body, Object.keys(PROFILE_COLUMNS));
    if (before.saved && !Object.keys(changes).length) return before;
    await db.query(`INSERT INTO salary_profiles (employee_id, basic_minor, allowance_minor, allowance_taxable, allowance_pensionable, pension_applies)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (employee_id) DO UPDATE SET
      basic_minor = EXCLUDED.basic_minor, allowance_minor = EXCLUDED.allowance_minor, allowance_taxable = EXCLUDED.allowance_taxable,
      allowance_pensionable = EXCLUDED.allowance_pensionable, pension_applies = EXCLUDED.pension_applies`,
    [id, ...Object.keys(PROFILE_COLUMNS).map((key) => req.body[key])]);
    await audit(db, { actorId: req.user.id, action: before.saved ? 'payroll.profile.update' : 'payroll.profile.create', entityType: 'salary_profile', entityId: id, details: { employeeId: id, changes } });
    return load(db, id);
  });
  res.json(saved);
}));
export default router;
