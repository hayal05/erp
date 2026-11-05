import {assertEmployeeScope,coversEmployee} from '../services/accessScope.js';
import {approvalWrap as wrap} from '../middleware/approval.js';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../services/hrSchemas.js';
import { validationError } from '../services/dbErrors.js';
import { loadSalaryProfile, parseSalaryProfile, saveSalaryProfile } from '../services/salaryProfiles.js';
const router = Router();
router.use(noStore, requirePermission('payroll.read'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('salary_profiles.manage')(req,res,next));
router.get('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const id = req.params.id;
  await assertEmployeeScope({query},req.user,'payroll.read',id);
  if (!(await query('SELECT 1 FROM employees WHERE id = $1', [id])).rowCount) throw new HttpError(404, 'Employee not found', 'not_found');
  const {rows:[employee]}=await query('SELECT department_id FROM employees WHERE id=$1',[id]);
  res.json({...await loadSalaryProfile({ query }, id),canManage:coversEmployee(req.user,'salary_profiles.manage',id,employee.department_id)});
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
