// Task 6.2: position validation reuses the salary-profile rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePosition, toPosition, positionSalary, POSITION_COLUMNS } from '../src/services/positions.js';
import { parseSalaryProfile, PROFILE_COLUMNS, SALARY_SCHEMA } from '../src/services/salaryProfiles.js';
import { JOB_TITLE_MAX, employeeUpdate } from '../src/services/hrSchemas.js';

const OK = { name: 'Cashier', basicMinor: 500000, allowanceMinor: 100000 };

test('position accepts a name and the five salary fields, defaults the flags, trims, and drops everything else', () => {
  assert.deepEqual(parsePosition({ ...OK, name: '  Cashier  ', id: 9, departmentId: 3, employeeCount: 4 }).value,
    { name: 'Cashier', basicMinor: 500000, allowanceMinor: 100000, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true });
  assert.equal(parsePosition({ ...OK, basicMinor: 0, allowanceMinor: 0, pensionApplies: false, allowanceTaxable: false }).value.pensionApplies, false);
});

test('position name is required, not blank, and no longer than a job title', () => {
  assert.ok(parsePosition({ basicMinor: 0, allowanceMinor: 0 }).errors.name);
  for (const bad of ['', '   ', 5, null, 'x'.repeat(JOB_TITLE_MAX + 1)]) assert.ok(parsePosition({ ...OK, name: bad }).errors.name, String(bad));
  assert.equal(parsePosition({ ...OK, name: 'x'.repeat(JOB_TITLE_MAX) }).errors, undefined);
});

test('the server writes the position name into job_title, so both limits are one number', () => {
  assert.equal(employeeUpdate.jobTitle.max, JOB_TITLE_MAX);
});

test('position money and flags follow exactly the salary-profile rules (one shared schema)', () => {
  for (const key of ['basicMinor', 'allowanceMinor']) {
    for (const bad of [-1, 1.5, '100', 10000000000000, null, undefined]) {
      const fromPosition = parsePosition({ ...OK, [key]: bad }).errors?.[key];
      const fromProfile = parseSalaryProfile({ basicMinor: 0, allowanceMinor: 0, [key]: bad }).errors?.[key];
      assert.ok(fromPosition, `${key}=${bad}`);
      assert.equal(fromPosition, fromProfile);
    }
  }
  for (const flag of ['allowanceTaxable', 'allowancePensionable', 'pensionApplies']) assert.ok(parsePosition({ ...OK, [flag]: 'false' }).errors[flag]);
  assert.equal(parsePosition({ ...OK, basicMinor: 9999999999999, allowanceMinor: 9999999999999 }).errors, undefined);
  assert.deepEqual(Object.keys(SALARY_SCHEMA), Object.keys(PROFILE_COLUMNS));
});

test('a non-object body is rejected', () => {
  for (const bad of [null, undefined, 'x', [], 7]) assert.ok(parsePosition(bad).errors);
});

test('toPosition maps pg rows (bigint as text) and includes employeeCount only when selected', () => {
  const row = { id: '7', department_id: '3', name: 'Cashier', basic_minor: '500000', allowance_minor: '100000', allowance_taxable: true, allowance_pensionable: false, pension_applies: true };
  assert.deepEqual(toPosition(row), { id: 7, departmentId: 3, name: 'Cashier', basicMinor: 500000, allowanceMinor: 100000, allowanceTaxable: true, allowancePensionable: false, pensionApplies: true });
  assert.equal(toPosition({ ...row, employee_count: 2 }).employeeCount, 2);
  assert.equal(toPosition({ ...row, employee_count: 0 }).employeeCount, 0);
});

test('a position package is exactly the five values a salary profile accepts (copies straight across)', () => {
  const position = toPosition({ id: '7', department_id: '3', name: 'Cashier', basic_minor: '500000', allowance_minor: '100000', allowance_taxable: true, allowance_pensionable: false, pension_applies: false });
  const salary = positionSalary(position);
  assert.deepEqual(Object.keys(salary), Object.keys(PROFILE_COLUMNS));
  assert.deepEqual(parseSalaryProfile(salary).value, salary); // validates and survives unchanged
  assert.deepEqual(Object.keys(POSITION_COLUMNS), ['name', ...Object.keys(PROFILE_COLUMNS)]);
});
