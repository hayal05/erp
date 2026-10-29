// Pure helpers for the Positions and salary table of a department (task 6.9). A position is a name plus the same salary
// package as an employee's salary profile, so the money rules come from salaryProfileForm.js (one copy of the rules).
import { formatMoney, tryMoney } from '../api/money.js';
import { profileForm, profilePayload } from './salaryProfileForm.js';
import { plural } from './departmentView.js';

export const POSITION_NAME_MAX = 100; // same limit as the job title: the server copies the position name into it

export const EMPTY_POSITION = { name: '', basic: '', allowance: '0', allowanceTaxable: true, allowancePensionable: true, pensionApplies: true };
export const positionForm = (p) => ({ name: p.name, ...profileForm(p) });

export function validatePosition(f) {
  const errors = {};
  const name = String(f.name ?? '').trim();
  if (!name) errors.name = 'Give the position a name';
  else if (name.length > POSITION_NAME_MAX) errors.name = `At most ${POSITION_NAME_MAX} characters`;
  if (!String(f.basic ?? '').trim()) errors.basic = 'Enter the basic salary (0 is allowed)';
  const salary = profilePayload({ ...f, basic: String(f.basic ?? '').trim() ? f.basic : '0' });
  if (salary.errors) for (const [k, msg] of Object.entries(salary.errors)) errors[k] ??= msg;
  return errors;
}

// Full body, like the server's PATCH (it replaces every editable field). Call only after validatePosition returned {}.
export function buildPosition(f) {
  const { value, errors } = profilePayload(f);
  if (errors) throw new Error('buildPosition needs a valid form');
  return { name: String(f.name).trim(), ...value };
}

export function positionChanged(f, p) {
  const b = buildPosition(f);
  return b.name !== p.name || b.basicMinor !== p.basicMinor || b.allowanceMinor !== p.allowanceMinor
    || b.allowanceTaxable !== p.allowanceTaxable || b.allowancePensionable !== p.allowancePensionable || b.pensionApplies !== p.pensionApplies;
}

// Server field names -> form field names, so 'basicMinor' shows under the Basic salary input.
export function positionServerFields(fields = {}) {
  const { basicMinor, allowanceMinor, ...rest } = fields;
  return { ...rest, ...(basicMinor ? { basic: basicMinor } : {}), ...(allowanceMinor ? { allowance: allowanceMinor } : {}) };
}

// "Taxable, pensionable" / "Not taxable, not pensionable" / "None" when there is no allowance.
export function allowanceNote(p) {
  if (!p.allowanceMinor) return '';
  return `${p.allowanceTaxable ? 'Taxable' : 'Not taxable'}, ${p.allowancePensionable ? 'pensionable' : 'not pensionable'}`;
}

export const positionRow = (p) => ({
  id: p.id, name: p.name, basic: formatMoney(p.basicMinor), allowance: formatMoney(p.allowanceMinor), allowanceNote: allowanceNote(p),
  pension: p.pensionApplies ? 'Yes' : 'No', employees: p.employeeCount ?? 0,
});

// The sum a new employee starts with, as shown in the dialog ('' while the amounts are not valid numbers yet).
export function monthlyTotal(f) {
  const basic = tryMoney(f.basic), allowance = tryMoney(f.allowance);
  return basic === null || allowance === null ? '' : formatMoney(basic + allowance);
}

export function deletePositionView(p) {
  const n = p.employeeCount ?? 0;
  if (n > 0) return { blocked: true, message: `${p.name} is held by ${plural(n, 'employee')}, including inactive ones. Move them to another position first.` };
  return { blocked: false, message: `Delete the position ${p.name}? Employees keep the salary they were given. This cannot be undone.` };
}

// What the dialog says about the people already on the position. Editing never changes their pay; renaming changes their job title.
export function editNotice(p) {
  const n = p?.employeeCount ?? 0;
  const base = 'Changing this salary does not change employees who already have this position. It applies to employees assigned to it from now on.';
  return n > 0 ? `${base} Renaming it updates the job title of ${plural(n, 'employee')}.` : base;
}

// A salary package (a position or an employee's salary profile: same five fields) as display text, for the employee form's
// preview and current-versus-new comparison (task 6.10).
export function salarySummary(src) {
  return {
    basic: formatMoney(src.basicMinor), allowance: formatMoney(src.allowanceMinor), allowanceNote: allowanceNote(src),
    pension: src.pensionApplies ? 'Yes' : 'No', total: formatMoney(src.basicMinor + src.allowanceMinor),
  };
}
export const SALARY_KEYS = ['basicMinor', 'allowanceMinor', 'allowanceTaxable', 'allowancePensionable', 'pensionApplies'];
export const sameSalary = (a, b) => SALARY_KEYS.every((k) => a[k] === b[k]);
