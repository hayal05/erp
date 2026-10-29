import { parse, v } from '../middleware/validate.js';
import { HttpError } from '../middleware/error.js';
import { audit, diffFields } from './audit.js';
import { MAX_MINOR } from './money.js';
export const PROFILE_DEFAULTS = Object.freeze({ basicMinor: 0, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true });
export const PROFILE_COLUMNS = { basicMinor: 'basic_minor', allowanceMinor: 'allowance_minor', allowanceTaxable: 'allowance_taxable', allowancePensionable: 'allowance_pensionable', pensionApplies: 'pension_applies' };
// The five salary fields and their limits. Salary profiles and positions (task 6.2) both validate with this one object,
// so the rules cannot drift apart.
export const SALARY_SCHEMA = {
  basicMinor: v.int({ required: true, min: 0, max: MAX_MINOR }),
  allowanceMinor: v.int({ required: true, min: 0, max: MAX_MINOR }),
  allowanceTaxable: v.boolean({ default: true }), allowancePensionable: v.boolean({ default: true }), pensionApplies: v.boolean({ default: true }),
};
export function parseSalaryProfile(body) {
  const { value, errors } = parse(SALARY_SCHEMA, body);
  return errors ? { errors } : { value };
}
export function toSalaryProfile(row, employeeId) {
  return row ? { employeeId: Number(row.employee_id), basicMinor: Number(row.basic_minor), allowanceMinor: Number(row.allowance_minor), allowanceTaxable: row.allowance_taxable, allowancePensionable: row.allowance_pensionable, pensionApplies: row.pension_applies, saved: true }
    : { employeeId: Number(employeeId), ...PROFILE_DEFAULTS, saved: false };
}
// Exactly the five salary fields of any object (a position, a profile, a request body), nothing else.
export const salaryValues = (src) => Object.fromEntries(Object.keys(PROFILE_COLUMNS).map((key) => [key, src[key]]));

export async function loadSalaryProfile(db, employeeId) {
  const { rows: [row] } = await db.query('SELECT * FROM salary_profiles WHERE employee_id = $1', [employeeId]);
  return toSalaryProfile(row, employeeId);
}

// The ONLY code that writes salary_profiles: the Salary dialog's PUT and (from task 6.5) employee create / position change
// both call it, so locking, no-op detection and auditing behave the same everywhere. Run it inside a transaction: the
// employee row lock serializes first-time saves as well as edits, and the audit row commits with the change.
// `values` must already be validated (parseSalaryProfile). `source` is an optional marker for the audit trail,
// e.g. { type: 'position', positionId }; it is added to the audit details only when given.
export async function saveSalaryProfile(db, { employeeId, actorId, values, source = null }) {
  if (!(await db.query('SELECT 1 FROM employees WHERE id = $1 FOR UPDATE', [employeeId])).rowCount) throw new HttpError(404, 'Employee not found', 'not_found');
  const before = await loadSalaryProfile(db, employeeId);
  const keys = Object.keys(PROFILE_COLUMNS);
  const changes = diffFields(before, values, keys);
  if (before.saved && !Object.keys(changes).length) return before;
  await db.query(`INSERT INTO salary_profiles (employee_id, basic_minor, allowance_minor, allowance_taxable, allowance_pensionable, pension_applies)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (employee_id) DO UPDATE SET
    basic_minor = EXCLUDED.basic_minor, allowance_minor = EXCLUDED.allowance_minor, allowance_taxable = EXCLUDED.allowance_taxable,
    allowance_pensionable = EXCLUDED.allowance_pensionable, pension_applies = EXCLUDED.pension_applies`,
  [employeeId, ...keys.map((key) => values[key])]);
  await audit(db, { actorId, action: before.saved ? 'payroll.profile.update' : 'payroll.profile.create', entityType: 'salary_profile', entityId: employeeId,
    details: { employeeId, changes, ...(source ? { source } : {}) } });
  return loadSalaryProfile(db, employeeId);
}
