import { loadAttendanceDeductions } from './payrollAttendance.js';
import { HttpError } from '../middleware/error.js';
import { computeEntry, PayrollError, validateBrackets } from './payrollEngine.js';
import { toSalaryProfile } from './salaryProfiles.js';
import { loadDeductions, consumeOneTimeDeductions } from './deductions.js';
import { audit } from './audit.js';

export const ENTRY_FIELDS = Object.freeze(['basicMinor', 'allowanceMinor', 'grossMinor', 'taxableIncomeMinor', 'incomeTaxRate', 'incomeTaxFixedDeductionMinor', 'incomeTaxMinor', 'otherTaxMinor', 'pensionableMinor', 'employeePensionRate', 'employeePensionMinor', 'employerPensionRate', 'employerPensionMinor', 'otherDeductionsMinor', 'netMinor', 'employerCostMinor']);
const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const toPeriod = (r) => ({ id: Number(r.id), month: r.month, status: r.status });
export const toEntry = (r) => ({ id: Number(r.id), employeeId: Number(r.employee_id), employeeCode: r.employee_code, employeeName: r.employee_name,
  ...Object.fromEntries(ENTRY_FIELDS.map((key) => [key, Number(r[snake(key)])])) });
export function parsePeriodMonth(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, 'Choose a month in YYYY-MM format', 'validation', { fields: { month: 'Use YYYY-MM (years 1000–9999)' } });
  return `${value}-01`;
}

// Caller supplies one transaction and a consistent configuration. Inserts, item consumption and audit commit together.
export async function generateDraft(db, { month, actorId, settings, brackets, otherTaxes }) {
  const problems = validateBrackets(brackets);
  if (problems.length) throw new HttpError(422, problems.join('; '), 'invalid_brackets');
  const { rows: employees } = await db.query(`SELECT e.id AS employee_id, e.employee_code, u.full_name, sp.id AS profile_id,
    sp.basic_minor, sp.allowance_minor, sp.allowance_taxable, sp.allowance_pensionable, sp.pension_applies
    FROM employees e JOIN users u ON u.id = e.user_id LEFT JOIN salary_profiles sp ON sp.employee_id = e.id
    WHERE e.status = 'active' ORDER BY e.id`);
  if (!employees.length) throw new HttpError(422, 'There are no active employees to pay', 'no_employees');
  const missing = employees.filter((e) => e.profile_id == null);
  if (missing.length) throw new HttpError(422, 'Save salary profiles for all active employees before generating payroll', 'missing_profiles', { employeeIds: missing.map((e) => Number(e.employee_id)) });
  const { rows: [period] } = await db.query(`INSERT INTO payroll_periods (period_month) VALUES ($1) RETURNING id, to_char(period_month, 'YYYY-MM') AS month, status`, [month]);
  const periodId = Number(period.id);
  for (const employee of employees) {
    const employeeId = Number(employee.employee_id);
    const deductions = await loadDeductions(db, employeeId, { lock: true });
    const attendance = await loadAttendanceDeductions(db, { employeeId, month, basicMinor: Number(employee.basic_minor), settings });
    let computed;
    try { computed = computeEntry({ settings, brackets, otherTaxes, profile: toSalaryProfile(employee), deductions: [...deductions, ...attendance] }); }
    catch (err) {
      if (err instanceof PayrollError) throw new HttpError(422, err.message, err.code, { employeeId });
      throw err;
    }
    const cols = ['period_id', 'employee_id', 'employee_code', 'employee_name', ...ENTRY_FIELDS.map(snake)];
    const values = [periodId, employeeId, employee.employee_code, employee.full_name, ...ENTRY_FIELDS.map((key) => computed[key])];
    const { rows: [entry] } = await db.query(`INSERT INTO payroll_entries (${cols.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, values);
    for (const item of computed.items) {
      await db.query(`INSERT INTO payroll_entry_items (entry_id, kind, label, rate, base_minor, amount_minor, source_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entry.id, item.kind, item.label, item.rate, item.baseMinor, item.amountMinor, item.sourceId]);
    }
    const ids = deductions.map((d) => d.sourceId);
    // loadDeductions returns engine inputs without recurring flags. Read those flags while its locks remain held.
    const { rows: once } = ids.length ? await db.query('SELECT id FROM deduction_items WHERE id = ANY($1::bigint[]) AND NOT recurring ORDER BY id', [ids]) : { rows: [] };
    await consumeOneTimeDeductions(db, periodId, once.map((r) => Number(r.id)));
  }
  await audit(db, { actorId, action: 'payroll.period.generate', entityType: 'payroll_period', entityId: periodId, details: { month: period.month, employeeCount: employees.length } });
  return { ...toPeriod(period), employeeCount: employees.length };
}
