import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyForm, formFromEmployee, validateForm, buildCreate, buildPatch } from '../src/pages/employeeForm.js';
import { PORTAL_NAV, firstName } from '../src/pages/portal/portalNav.js';

const employee = { id: 5, employeeCode: 'E-5', fullName: 'Abebe Kebede', email: 'a@natra.test', phone: '0911', departmentId: 2, jobTitle: 'Clerk',
  startDate: '2026-02-01', employmentType: 'full_time', shiftId: 3 };
const filled = { ...emptyForm(), employeeCode: 'E-9', fullName: ' Hana  ', email: 'h@natra.test', startDate: '2026-03-01', shiftId: '3', password: 'long-enough-pw' };

test('create validation: required fields, formats and password length', () => {
  assert.deepEqual(Object.keys(validateForm(emptyForm(), 'create')).sort(), ['email', 'employeeCode', 'fullName', 'password', 'startDate']);
  assert.deepEqual(validateForm(filled, 'create'), {});
  const bad = { ...filled, employeeCode: 'E 9', email: 'nope', phone: 'call', password: 'short' };
  assert.deepEqual(Object.keys(validateForm(bad, 'create')).sort(), ['email', 'employeeCode', 'password', 'phone']);
  assert.ok(validateForm({ ...filled, password: 'é'.repeat(37) }, 'create').password); // 74 bytes
  assert.equal(validateForm({ ...filled, fullName: '   ' }, 'create').fullName, 'Enter the full name');
});

test('edit validation does not ask for a password', () => {
  assert.deepEqual(validateForm(formFromEmployee(employee), 'edit'), {});
});

test('create payload: trimmed, blanks left out, ids are numbers, password untouched', () => {
  const body = buildCreate({ ...filled, password: ' spaced pw ', departmentId: '2' });
  assert.deepEqual(body, { employeeCode: 'E-9', fullName: 'Hana', email: 'h@natra.test', startDate: '2026-03-01', employmentType: 'full_time',
    password: ' spaced pw ', departmentId: 2, shiftId: 3 });
  assert.equal('phone' in body, false);
  assert.equal('jobTitle' in buildCreate(filled), false);
});

test('patch payload: only changed fields; blank optional fields become null', () => {
  const same = formFromEmployee(employee);
  assert.deepEqual(buildPatch(same, employee), {});
  assert.deepEqual(buildPatch({ ...same, fullName: ' Abebe Kebede ' }, employee), {}); // whitespace is not a change
  assert.deepEqual(buildPatch({ ...same, jobTitle: 'Lead', phone: '', departmentId: '', shiftId: '4' }, employee),
    { jobTitle: 'Lead', phone: null, departmentId: null, shiftId: 4 });
  assert.deepEqual(buildPatch({ ...same, email: 'new@natra.test', employmentType: 'contract' }, employee), { email: 'new@natra.test', employmentType: 'contract' });
});

test('form from a record without optional values uses empty strings', () => {
  const f = formFromEmployee({ ...employee, phone: null, departmentId: null, jobTitle: null });
  assert.deepEqual([f.phone, f.departmentId, f.jobTitle, f.password], ['', '', '', '']);
});

test('portal nav: 4 unique tabs under /portal, only Home is exact-match', () => {
  assert.deepEqual(PORTAL_NAV.map((i) => i.label), ['Home', 'Attendance', 'Leave', 'Payslips']);
  assert.ok(PORTAL_NAV.every((i) => i.to === '/portal' || i.to.startsWith('/portal/')));
  assert.deepEqual(PORTAL_NAV.filter((i) => i.end).map((i) => i.key), ['home']);
  assert.equal(firstName('  Eli Employee '), 'Eli');
  assert.equal(firstName(''), 'there');
});
