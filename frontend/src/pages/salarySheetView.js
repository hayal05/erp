import { formatMoney, parseMoney } from '../api/money.js';
export const SALARY_COLUMNS = Object.freeze([
  { key: 'employeeCode', header: 'Employee ID' }, { key: 'employeeName', header: 'Employee Name' },
  { key: 'basicMinor', header: 'Basic Salary', editable: true }, { key: 'allowanceMinor', header: 'Allowance', editable: true },
  { key: 'incomeTaxMinor', header: 'Income Tax' }, { key: 'otherTaxMinor', header: 'Other Tax' },
  { key: 'employeePensionMinor', header: 'Pension' }, { key: 'otherDeductionsMinor', header: 'Other Deductions' }, { key: 'netMinor', header: 'Net Salary' },
]);
export function periodIdFromParam(value) {
  if (value == null) return null;
  const n = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(n) ? n : false;
}
export const salaryEditForm = (entry) => ({ basicMinor: formatMoney(entry.basicMinor), allowanceMinor: formatMoney(entry.allowanceMinor) });
export function salaryEditPayload(form) {
  const value = {}, errors = {};
  for (const key of ['basicMinor', 'allowanceMinor']) {
    try { value[key] = parseMoney(form[key]); } catch (e) { errors[key] = e.message; }
  }
  return Object.keys(errors).length ? { errors } : { value };
}
export const canEditSalary = (period) => period?.status === 'draft';
