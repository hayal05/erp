import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyForm, formFromEmployee, validateForm, buildCreate, buildPatch, changeDepartment, needsCurrentSalary, positionOptions, salaryPlan, savedMessage } from '../src/pages/employeeForm.js';
import { PORTAL_NAV, firstName } from '../src/pages/portal/portalNav.js';

const employee = { id: 5, employeeCode: 'E-5', fullName: 'Abebe Kebede', username:'abebe',email: 'a@natra.test', phone: '0911', departmentId: 2, positionId: null, jobTitle: 'Clerk',
  startDate: '2026-02-01', employmentType: 'full_time', shiftId: 3 };
const filled = { ...emptyForm(), employeeCode: 'E-9', fullName: ' Hana  ',username:'hana', email: 'h@natra.test', startDate: '2026-03-01', shiftId: '3', password: 'long-enough-pw' };

test('create validation: required fields, formats and password length', () => {
  assert.deepEqual(Object.keys(validateForm(emptyForm(), 'create')).sort(), ['employeeCode', 'fullName', 'password', 'startDate','username']);
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
  assert.deepEqual(body, { employeeCode: 'E-9', fullName: 'Hana', username:'hana',email: 'h@natra.test', startDate: '2026-03-01', employmentType: 'full_time',
    password: ' spaced pw ', departmentId: 2, shiftId: 3 });
  assert.equal('phone' in body, false);
  assert.equal('jobTitle' in buildCreate(filled), false);
});

test('patch payload: only changed fields; blank optional fields become null', () => {
  const same = formFromEmployee(employee);
  assert.deepEqual(buildPatch(same, employee), {});
  assert.deepEqual(buildPatch({ ...same, fullName: ' Abebe Kebede ' }, employee), {}); // whitespace is not a change
  // Changed in task 6.10 on purpose: the free-text job title is gone from the form (the position owns the title), so editing
  // the legacy value is no longer a change that can be sent.
  assert.deepEqual(buildPatch({ ...same, jobTitle: 'Lead', phone: '', departmentId: '', shiftId: '4' }, employee),
    { phone: null, departmentId: null, shiftId: 4 });
  assert.deepEqual(buildPatch({ ...same, email: 'new@natra.test', employmentType: 'contract' }, employee), { email: 'new@natra.test', employmentType: 'contract' });
});

test('form from a record without optional values uses empty strings', () => {
  const f = formFromEmployee({ ...employee, phone: null, departmentId: null, jobTitle: null });
  assert.deepEqual([f.phone, f.departmentId, f.positionId, f.jobTitle, f.password], ['', '', '', '', '']);
});

test('portal nav: 5 unique tabs under /portal, only Home is exact-match', () => {
  assert.deepEqual(PORTAL_NAV.map((i) => i.label), ['Home', 'Attendance', 'Leave', 'Profile', 'Payslips']);
  assert.ok(PORTAL_NAV.every((i) => i.to === '/portal' || i.to.startsWith('/portal/')));
  assert.deepEqual(PORTAL_NAV.filter((i) => i.end).map((i) => i.key), ['home']);
  assert.equal(firstName('  Eli Employee '), 'Eli');
  assert.equal(firstName(''), 'there');
});

// ---- Task 6.10: position and default salary
const POSITIONS = [
  { id: 11, departmentId: 2, name: 'Accountant', basicMinor: 1500000, allowanceMinor: 250000, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true },
  { id: 12, departmentId: 2, name: 'Clerk', basicMinor: 800000, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true },
];
const PROFILE = { basicMinor: 800000, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true, saved: true };
const holder = { ...employee, positionId: 12, jobTitle: 'Clerk' };

test('create with a position sends only the position id: no salary figures, no job title', () => {
  const body = buildCreate({ ...filled, departmentId: '2', positionId: '11', jobTitle: 'Boss' });
  assert.equal(body.positionId, 11);
  assert.equal(body.departmentId, 2);
  for (const k of ['jobTitle', 'basicMinor', 'allowanceMinor', 'salary', 'applyPositionSalary']) assert.equal(k in body, false, k);
  assert.equal('positionId' in buildCreate({ ...filled, departmentId: '2' }), false);
  assert.equal('positionId' in buildCreate({ ...filled, positionId: '11' }), false); // never a position without a department
});

test('edit: choosing a position sends it with the checkbox, checked by default', () => {
  const base = formFromEmployee(employee);
  assert.equal(base.applyPositionSalary, true);
  assert.deepEqual(buildPatch({ ...base, positionId: '11' }, employee), { positionId: 11, applyPositionSalary: true });
  assert.deepEqual(buildPatch({ ...base, positionId: '11', applyPositionSalary: false }, employee), { positionId: 11, applyPositionSalary: false });
});

test('edit: an unchanged position sends nothing, even with the checkbox state in the form', () => {
  const same = formFromEmployee(holder);
  assert.deepEqual(buildPatch(same, holder), {});
  assert.deepEqual(buildPatch({ ...same, applyPositionSalary: false }, holder), {});
});

test('edit: clearing the position sends null and no salary flag; a department change drops the position', () => {
  const same = formFromEmployee(holder);
  assert.deepEqual(buildPatch({ ...same, positionId: '' }, holder), { positionId: null });
  const moved = changeDepartment(same, '3', holder);
  assert.deepEqual([moved.departmentId, moved.positionId], ['3', '']);
  assert.deepEqual(buildPatch(moved, holder), { departmentId: 3, positionId: null });
  // department and a position of the new department together
  assert.deepEqual(buildPatch({ ...moved, positionId: '40' }, holder), { departmentId: 3, positionId: 40, applyPositionSalary: true });
});

test('switching the department back restores the original position; a new department never carries one over', () => {
  const same = formFromEmployee(holder);
  const away = changeDepartment(same, '3', holder);
  const back = changeDepartment(away, '2', holder);
  assert.equal(back.positionId, '12');
  assert.deepEqual(buildPatch(back, holder), {});
  assert.equal(changeDepartment(formFromEmployee(employee), '2', employee).positionId, ''); // no original position to restore
  assert.equal(changeDepartment(same, '', holder).positionId, '');
  assert.equal(changeDepartment({ ...emptyForm(), positionId: '11' }, '2', null).positionId, '');
  assert.equal(changeDepartment({ ...away, applyPositionSalary: false }, '4', holder).applyPositionSalary, true); // checkbox resets
});

test('salary plan: nothing chosen, new-employee preview, change with comparison, same position, cleared', () => {
  const none = salaryPlan({ form: emptyForm(), original: null, positions: POSITIONS, profile: null });
  assert.deepEqual(none, { kind: 'none' });

  const preview = salaryPlan({ form: { ...emptyForm(), positionId: '11' }, original: null, positions: POSITIONS, profile: null });
  assert.equal(preview.kind, 'preview');
  assert.deepEqual(preview.next, { basic: '15,000.00', allowance: '2,500.00', allowanceNote: 'Taxable, pensionable', pension: 'Yes', total: '17,500.00' });

  const change = salaryPlan({ form: { ...formFromEmployee(holder), positionId: '11' }, original: holder, positions: POSITIONS, profile: PROFILE });
  assert.equal(change.kind, 'change');
  assert.equal(change.current.total, '8,000.00');
  assert.equal(change.next.total, '17,500.00');
  assert.equal(change.same, false);
  assert.equal(change.apply, true);
  assert.equal(salaryPlan({ form: { ...formFromEmployee(holder), positionId: '11', applyPositionSalary: false }, original: holder, positions: POSITIONS, profile: PROFILE }).apply, false);

  // current salary unknown (still loading or failed): the comparison still shows the new package
  const unknown = salaryPlan({ form: { ...formFromEmployee(holder), positionId: '11' }, original: holder, positions: POSITIONS, profile: null });
  assert.deepEqual([unknown.kind, unknown.current, unknown.same], ['change', null, false]);

  // identical packages are called out
  const sameSalary = salaryPlan({ form: { ...formFromEmployee(employee), positionId: '12' }, original: employee, positions: POSITIONS, profile: PROFILE });
  assert.equal(sameSalary.same, true);

  assert.deepEqual(salaryPlan({ form: formFromEmployee(holder), original: holder, positions: POSITIONS, profile: PROFILE }), { kind: 'none' });
  assert.deepEqual(salaryPlan({ form: { ...formFromEmployee(holder), positionId: '' }, original: holder, positions: POSITIONS, profile: PROFILE }), { kind: 'cleared' });
  assert.deepEqual(salaryPlan({ form: { ...emptyForm(), positionId: '99' }, original: null, positions: POSITIONS, profile: null }), { kind: 'none' }); // not (yet) in the list
});

test('the current salary is fetched only when the position of an existing employee changes to a real one', () => {
  assert.equal(needsCurrentSalary(formFromEmployee(holder), holder), false);
  assert.equal(needsCurrentSalary({ ...formFromEmployee(holder), positionId: '11' }, holder), true);
  assert.equal(needsCurrentSalary({ ...formFromEmployee(holder), positionId: '' }, holder), false);
  assert.equal(needsCurrentSalary({ ...emptyForm(), positionId: '11' }, null), false);
});

test('position options and the save messages', () => {
  assert.deepEqual(positionOptions(POSITIONS), [{ value: 11, label: 'Accountant' }, { value: 12, label: 'Clerk' }]);
  assert.match(savedMessage('create', { positionId: 11 }, { fullName: 'Hana', positionName: 'Accountant' }), /Hana was added with the salary of the Accountant position/);
  assert.equal(savedMessage('create', {}, { fullName: 'Hana' }), 'Hana was added');
  assert.match(savedMessage('edit', { positionId: 11, applyPositionSalary: true }), /salary now follows/);
  assert.match(savedMessage('edit', { positionId: 11, applyPositionSalary: false }), /current salary was kept/);
  assert.equal(savedMessage('edit', { phone: null }), 'Changes saved');
});

// ---- Task 6.11: error mapping and the contract with the server
import { readFileSync } from 'node:fs';
import { employeeSaveError } from '../src/pages/employeeForm.js';

test('save errors: field messages for 400, 409 and 422 stay on the inputs; the top message is one readable line', () => {
  const dup = employeeSaveError({ status: 409, fields: { email: 'Email already in use' }, message: 'Conflict' });
  assert.deepEqual(dup, { fields: { email: 'Email already in use' }, message: 'Please fix the highlighted fields.' });

  // 422: position of another department -> under the Position input
  const wrong = employeeSaveError({ status: 422, fields: { positionId: 'This position belongs to a different department' }, message: 'x' });
  assert.deepEqual(wrong.fields, { positionId: 'This position belongs to a different department' });

  // the apply flag has no input of its own: its message goes to the top
  const apply = employeeSaveError({ status: 422, fields: { applyPositionSalary: 'Choose a position to apply its salary' }, message: 'x' });
  assert.equal(apply.message, 'Choose a position to apply its salary');

  assert.equal(employeeSaveError({ status: 400, fields: { _: 'Nothing to change' } }).message, 'Nothing to change');
});

test('save errors without fields: the error text, or a safe default; fields from other statuses are not put on inputs', () => {
  assert.deepEqual(employeeSaveError({ status: 0, code: 'network', fields: {}, message: 'Cannot reach the server' }), { fields: {}, message: 'Cannot reach the server' });
  assert.deepEqual(employeeSaveError({ status: 500, fields: {}, message: '' }), { fields: {}, message: 'Something went wrong. Nothing was saved.' });
  assert.equal(employeeSaveError(undefined).message, 'Something went wrong. Nothing was saved.');
  assert.deepEqual(employeeSaveError({ status: 500, fields: { email: 'x' }, message: 'boom' }).fields, {});
});

// Drift guard: every key the browser sends must be a key the server schema accepts (the server drops unknown keys silently,
// which would turn a typo here into a salary that is never applied). Reads the server's source text; no server code is run.
const server = (file) => readFileSync(new URL(`../../backend/src/${file}`, import.meta.url), 'utf8');

test('employee payload keys exist in the server schemas', () => {
  const hr = server('services/hrSchemas.js');
  const update = ['positionId', 'applyPositionSalary', 'departmentId', 'shiftId', 'phone', 'employeeCode', 'fullName', 'email', 'startDate', 'employmentType'];
  for (const key of update) assert.match(hr, new RegExp(`\\b${key}\\b`), `hrSchemas.js does not mention ${key}`);
  const form = formFromEmployee(employee);
  const sent = new Set([...Object.keys(buildPatch({ ...form, positionId: '11', departmentId: '3', phone: '1', shiftId: '4', fullName: 'N' }, employee)),
    ...Object.keys(buildCreate({ ...filled, departmentId: '2', positionId: '11', phone: '0911' }))]);
  for (const key of sent) assert.match(hr, new RegExp(`\\b${key}\\b`), `the browser sends ${key}, the server schema never mentions it`);
});

test('position payload keys exist in the server salary and position schemas', async () => {
  const { buildPosition, EMPTY_POSITION } = await import('../src/pages/positionForm.js');
  const src = server('services/salaryProfiles.js') + server('services/positions.js');
  for (const key of Object.keys(buildPosition({ ...EMPTY_POSITION, name: 'A', basic: '1' }))) assert.match(src, new RegExp(`\\b${key}\\b`), key);
});


test('username is required independently of optional contact email',()=>{
 const form={...filled,email:''};assert.deepEqual(validateForm(form,'create'),{});
 const created=buildCreate(form);assert.equal(created.username,'hana');assert.equal('email' in created,false);
 assert.ok(validateForm({...form,username:''},'create').username);
 assert.ok(validateForm({...form,username:'has spaces'},'create').username);
 const original={...employee,username:'abebe',email:'old@test.co'};
 assert.deepEqual(buildPatch({...formFromEmployee(original),email:''},original),{email:null});
 assert.deepEqual(buildPatch({...formFromEmployee(original),username:'NEW.LOGIN'},original),{username:'new.login'});
 const legacy={...employee,username:"legacy'name@test.co"};assert.deepEqual(validateForm(formFromEmployee(legacy),'edit',legacy),{});
});
