import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DEPARTMENT, buildDepartment, deleteView, departmentChanged, departmentRow, plural, saveErrorView, validateDepartment } from '../src/pages/departmentView.js';

const DEPT = { id: 3, name: 'Sales', employeeCount: 0, positionCount: 0 };

test('department name: required, trimmed, at most 100 characters', () => {
  assert.deepEqual(validateDepartment(EMPTY_DEPARTMENT), { name: 'Give the department a name' });
  assert.deepEqual(validateDepartment({ name: '   ' }), { name: 'Give the department a name' });
  assert.deepEqual(validateDepartment({ name: undefined }), { name: 'Give the department a name' });
  assert.ok(validateDepartment({ name: 'x'.repeat(101) }).name);
  assert.deepEqual(validateDepartment({ name: 'x'.repeat(100) }), {});
  assert.deepEqual(validateDepartment({ name: ' Sales ' }), {});
  // the limit applies after trimming, like the server
  assert.deepEqual(validateDepartment({ name: ` ${'x'.repeat(100)} ` }), {});
});

test('the request body is the trimmed name and nothing else', () => {
  assert.deepEqual(buildDepartment({ name: '  Sales  ', id: 9, employeeCount: 4 }), { name: 'Sales' });
});

test('a rename is detected, a whitespace-only difference is not, a case change is', () => {
  assert.equal(departmentChanged({ name: 'Sales' }, DEPT), false);
  assert.equal(departmentChanged({ name: '  Sales ' }, DEPT), false);
  assert.equal(departmentChanged({ name: 'sales' }, DEPT), true);
  assert.equal(departmentChanged({ name: 'Marketing' }, DEPT), true);
});

test('counts read naturally in singular and plural', () => {
  assert.equal(plural(0, 'position'), '0 positions');
  assert.equal(plural(1, 'position'), '1 position');
  assert.equal(plural(2, 'employee'), '2 employees');
  assert.equal(plural(1, 'person', 'people'), '1 person');
  assert.equal(plural(3, 'person', 'people'), '3 people');
});

test('table rows carry the counts, defaulting to zero when the server omits them', () => {
  assert.deepEqual(departmentRow({ ...DEPT, employeeCount: 12, positionCount: 3 }), { id: 3, name: 'Sales', employees: 12, positions: 3 });
  assert.deepEqual(departmentRow({ id: 4, name: 'Ops' }), { id: 4, name: 'Ops', employees: 0, positions: 0 });
});

test('delete: positions block first (the server checks them first), then employees, otherwise it is allowed', () => {
  const both = deleteView({ ...DEPT, employeeCount: 5, positionCount: 2 });
  assert.equal(both.blocked, true);
  assert.match(both.message, /2 positions/);
  assert.doesNotMatch(both.message, /employee/);

  const one = deleteView({ ...DEPT, positionCount: 1 });
  assert.match(one.message, /1 position\./);

  const staff = deleteView({ ...DEPT, employeeCount: 1 });
  assert.equal(staff.blocked, true);
  assert.match(staff.message, /1 employee,/);
  assert.match(staff.message, /inactive/);

  const free = deleteView(DEPT);
  assert.equal(free.blocked, false);
  assert.match(free.message, /cannot be undone/);
  assert.equal(deleteView({ id: 1, name: 'X' }).blocked, false); // missing counts are treated as zero
});

test('save and delete errors: field messages stay on the fields, everything else becomes one readable message', () => {
  assert.deepEqual(saveErrorView({ fields: { name: 'Already exists' }, message: 'x' }), { fields: { name: 'Already exists' }, message: '' });
  assert.match(saveErrorView({ status: 0, code: 'network', fields: {} }).message, /Cannot reach the server/);
  assert.match(saveErrorView({ code: 'network' }).message, /Nothing was changed/);
  assert.match(saveErrorView({ status: 404, fields: {} }).message, /no longer exists/);
  assert.equal(saveErrorView({ status: 409, code: 'in_use', message: 'Department still has positions. Delete its positions first.', fields: {} }).message,
    'Department still has positions. Delete its positions first.');
  assert.match(saveErrorView(undefined).message, /Something went wrong/);
  assert.deepEqual(saveErrorView({ message: 'x' }).fields, {});
});
