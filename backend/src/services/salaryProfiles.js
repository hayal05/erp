import { parse, v } from '../middleware/validate.js';
import { MAX_MINOR } from './money.js';
export const PROFILE_DEFAULTS = Object.freeze({ basicMinor: 0, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true });
export const PROFILE_COLUMNS = { basicMinor: 'basic_minor', allowanceMinor: 'allowance_minor', allowanceTaxable: 'allowance_taxable', allowancePensionable: 'allowance_pensionable', pensionApplies: 'pension_applies' };
export function parseSalaryProfile(body) {
  const { value, errors } = parse({
    basicMinor: v.int({ required: true, min: 0, max: MAX_MINOR }),
    allowanceMinor: v.int({ required: true, min: 0, max: MAX_MINOR }),
    allowanceTaxable: v.boolean({ default: true }), allowancePensionable: v.boolean({ default: true }), pensionApplies: v.boolean({ default: true }),
  }, body);
  return errors ? { errors } : { value };
}
export function toSalaryProfile(row, employeeId) {
  return row ? { employeeId: Number(row.employee_id), basicMinor: Number(row.basic_minor), allowanceMinor: Number(row.allowance_minor), allowanceTaxable: row.allowance_taxable, allowancePensionable: row.allowance_pensionable, pensionApplies: row.pension_applies, saved: true }
    : { employeeId: Number(employeeId), ...PROFILE_DEFAULTS, saved: false };
}
