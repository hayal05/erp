import { HttpError } from '../middleware/error.js';

export const validationError = (fields) => new HttpError(400, 'Invalid request', 'validation', { fields });
// PostgreSQL can report an immediate ON DELETE RESTRICT action as restrict_violation (23001).
export const isFkViolation = (err) => err?.code === '23503' || err?.code === '23001';

// Constraint names come from database/migrations/001_core.sql.
const CONFLICT = {
  users_email_key: ['email', 'This email is already in use'],
  employees_code_key: ['employeeCode', 'This employee ID is already in use'],
  departments_name_key: ['name', 'A department with this name already exists'],
  shifts_name_key: ['name', 'A shift with this name already exists'],
  holidays_date_key: ['date', 'A holiday is already set on this date'], // 003_leave.sql
  other_taxes_name_key: ['name', 'An other tax with this name already exists'], // 004_payroll.sql (unique index on lower(name))
};
const MISSING_REF = {
  employees_department_id_fkey: ['departmentId', 'Department not found'],
  employees_shift_id_fkey: ['shiftId', 'Shift not found'],
  deduction_items_employee_id_fkey: ['employeeId', 'Employee not found'], // 004_payroll.sql
};
const CHECK = {
  shifts_same_day: ['endTime', 'End time must be after start time'],
  deduction_items_recurring_never_consumed: ['recurring', 'An item already applied to a payroll cannot be made recurring'], // 004_payroll.sql
  deduction_items_amount_minor_check: ['amountMinor', 'Must be a positive amount'],
};

// Turns an expected database rejection into a field-level HttpError; anything else is returned as is.
export function translateDbError(err) {
  const name = err?.constraint;
  if (err?.code === '23505' && CONFLICT[name]) {
    const [field, message] = CONFLICT[name];
    return new HttpError(409, message, 'conflict', { fields: { [field]: message } });
  }
  if (err?.code === '23503' && MISSING_REF[name]) return validationError({ [MISSING_REF[name][0]]: MISSING_REF[name][1] });
  if (err?.code === '23514' && CHECK[name]) return validationError({ [CHECK[name][0]]: CHECK[name][1] });
  return err;
}
