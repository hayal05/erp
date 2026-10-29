import { parse, v } from '../middleware/validate.js';
import { HttpError } from '../middleware/error.js';
import { JOB_TITLE_MAX } from './hrSchemas.js';
import { validationError } from './dbErrors.js';
import { PROFILE_COLUMNS, SALARY_SCHEMA, salaryValues } from './salaryProfiles.js';

// A position is a department-scoped job with a default salary package (task 6.1, migration 005). The salary part has the
// same five fields and limits as an employee's salary profile (SALARY_SCHEMA), so a package copies straight across.
// The name is limited to the job-title length because the server writes the position name into employees.job_title.
export const POSITION_COLUMNS = { name: 'name', ...PROFILE_COLUMNS };

// Body of POST /departments/:id/positions and PATCH /positions/:id (a full replacement of the editable fields, like the
// salary profile PUT). The department comes from the URL and is never read from the body.
export function parsePosition(body) {
  const { value, errors } = parse({ name: v.string({ required: true, max: JOB_TITLE_MAX }), ...SALARY_SCHEMA }, body);
  return errors ? { errors } : { value };
}

export const toPosition = (row) => ({
  id: Number(row.id), departmentId: Number(row.department_id), name: row.name,
  basicMinor: Number(row.basic_minor), allowanceMinor: Number(row.allowance_minor),
  allowanceTaxable: row.allowance_taxable, allowancePensionable: row.allowance_pensionable, pensionApplies: row.pension_applies,
  ...(row.employee_count === undefined ? {} : { employeeCount: Number(row.employee_count) }),
});

// The salary package of a position, shaped exactly like the values saveSalaryProfile expects.
export const positionSalary = (position) => salaryValues(position);

// Loads a position for assigning it to an employee of `departmentId`, and locks it FOR SHARE so a concurrent rename,
// salary edit or delete of the position waits until this transaction ends (the copied package and job title are then
// exactly what the position held). 400 when it does not exist, 422 when it belongs to another department (task 6.5).
export async function loadAssignablePosition(db, positionId, departmentId) {
  const { rows: [row] } = await db.query('SELECT * FROM positions WHERE id = $1 FOR SHARE', [positionId]);
  if (!row) throw validationError({ positionId: 'Position not found' });
  const message = departmentId == null ? 'Choose a department before choosing a position'
    : Number(row.department_id) !== Number(departmentId) ? 'This position belongs to a different department' : null;
  if (message) throw new HttpError(422, message, 'validation', { fields: { positionId: message } });
  return toPosition(row);
}
