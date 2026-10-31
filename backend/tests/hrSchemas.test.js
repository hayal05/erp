import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
const { parse, v } = await import('../src/middleware/validate.js');
const { employeeCreate, employeeUpdate, employeeListQuery, shiftCreate, shiftUpdate, departmentBody, idParams } =
  await import('../src/services/hrSchemas.js');
const { pageOffset, pageResult, likePattern, setClause } = await import('../src/services/sql.js');
const { translateDbError, validationError, isFkViolation } = await import('../src/services/dbErrors.js');
const { diffFields } = await import('../src/services/audit.js');
const { HttpError } = await import('../src/middleware/error.js');

const goodEmployee = { gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',employeeCode: 'EMP-001', fullName: ' Abebe Kebede ', username: 'Abebe@Natra.test', email: 'Abebe@Natra.test', startDate: '2026-01-15', password: 'a-long-password' };

test('intList: sorted, unique, bounded whole numbers', () => {
  const rule = { d: v.intList({ min: 1, max: 7, minItems: 1, maxItems: 7 }) };
  assert.deepEqual(parse(rule, { d: [5, 1, 3] }).value, { d: [1, 3, 5] });
  for (const bad of [[], [0], [8], [1, 1], [1.5], ['1'], 'x', [1, 2, 3, 4, 5, 6, 7, 7]]) {
    assert.ok(parse(rule, { d: bad }).errors?.d, JSON.stringify(bad));
  }
});

test('employee create: required fields, defaults, trimming and dropped unknown keys', () => {
  const { value, errors } = parse(employeeCreate, { ...goodEmployee, role: 'hr', status: 'inactive', userId: 1 });
  assert.equal(errors, null);
  assert.equal(value.fullName, 'Abebe Kebede');
  assert.equal(value.email, 'abebe@natra.test');
  assert.equal(value.employmentType, 'full_time');
  assert.equal(value.shiftId, undefined);
  for (const k of ['role', 'status', 'userId']) assert.equal(k in value, false, k); // no mass assignment
  const missing = parse(employeeCreate, {}).errors;
  assert.deepEqual(Object.keys(missing).sort(), ['dateOfBirth','employeeCode','fieldOfStudy','fullName','gender','password','startDate','username']);
});

test('employee create: the password is not trimmed', () => {
  assert.equal(parse(employeeCreate, { ...goodEmployee, password: '  spaced password  ' }).value.password, '  spaced password  ');
});

test('employee fields reject bad codes, phones, dates, types and ids', () => {
  const bad = { employeeCode: 'EMP 1', phone: 'call me', startDate: '2026-02-30', employmentType: 'boss', departmentId: 0, shiftId: '3' };
  const errors = parse(employeeCreate, { ...goodEmployee, ...bad }).errors;
  assert.deepEqual(Object.keys(errors).sort(), ['departmentId', 'employeeCode', 'employmentType', 'phone', 'shiftId', 'startDate']);
});

test('employee update: nothing defaulted, null clears optional fields, blank means unchanged', () => {
  assert.deepEqual(parse(employeeUpdate, {}).value, {});
  assert.deepEqual(parse(employeeUpdate, { phone: null, departmentId: null, jobTitle: null }).value, { phone: null, departmentId: null, jobTitle: null });
  assert.deepEqual(parse(employeeUpdate, { phone: '  ' }).value, {});
  assert.deepEqual(parse(employeeUpdate, { fullName: null }).errors, null); // null on a non-nullable field = omitted, never stored
  assert.equal('fullName' in parse(employeeUpdate, { fullName: null }).value, false);
});

test('employee list query: coerces strings, defaults paging, caps page size', () => {
  assert.deepEqual(parse(employeeListQuery, {}, { coerce: true }).value, { page: 1, pageSize: 25 });
  assert.deepEqual(parse(employeeListQuery, { page: '3', pageSize: '10', status: 'active', departmentId: '2', search: ' ann ' }, { coerce: true }).value,
    { page: 3, pageSize: 10, status: 'active', departmentId: 2, search: 'ann' });
  for (const bad of [{ pageSize: '101' }, { pageSize: '0' }, { page: '0' }, { page: '1.5' }, { status: 'gone' }, { page: ['1', '2'] }]) {
    assert.ok(parse(employeeListQuery, bad, { coerce: true }).errors, JSON.stringify(bad));
  }
});

test('ids in the URL must be positive whole numbers', () => {
  assert.deepEqual(parse(idParams, { id: '12' }, { coerce: true }).value, { id: 12 });
  for (const bad of ['0', '-1', 'abc', '1; DROP TABLE users', '1e3', '']) assert.ok(parse(idParams, { id: bad }, { coerce: true }).errors, bad);
});

test('shift create: defaults, time format, grace and weekday limits', () => {
  const { value } = parse(shiftCreate, { name: 'Early', startTime: '07:00', endTime: '15:00' });
  assert.deepEqual(value, { name: 'Early', startTime: '07:00', endTime: '15:00', graceMinutes: 0, workDays: [1, 2, 3, 4, 5] });
  const errors = parse(shiftCreate, { name: 'X', startTime: '7:00', endTime: '24:00', graceMinutes: 241, workDays: [0, 8] }).errors;
  assert.deepEqual(Object.keys(errors).sort(), ['endTime', 'graceMinutes', 'startTime', 'workDays']);
  assert.deepEqual(parse(shiftUpdate, { workDays: [6, 7] }).value, { workDays: [6, 7] });
});

test('department needs a name', () => {
  assert.deepEqual(parse(departmentBody, {}).errors, { name: 'Required' });
  assert.deepEqual(parse(departmentBody, { name: ' Finance ' }).value, { name: 'Finance' });
});

test('paging helpers', () => {
  assert.equal(pageOffset({ page: 1, pageSize: 25 }), 0);
  assert.equal(pageOffset({ page: 3, pageSize: 10 }), 20);
  assert.deepEqual(pageResult(['a'], { page: 2, pageSize: 5 }, 11), { items: ['a'], page: 2, pageSize: 5, total: 11 });
});

test('likePattern makes user wildcards literal', () => {
  assert.equal(likePattern('ann'), '%ann%');
  assert.equal(likePattern('100%'), '%100\\%%');
  assert.equal(likePattern('a_b'), '%a\\_b%');
  assert.equal(likePattern('a\\b'), '%a\\\\b%');
});

test('setClause only emits whitelisted columns that are present, numbered from $2', () => {
  const cols = { fullName: 'full_name', email: 'email' };
  assert.deepEqual(setClause(cols, { email: 'a@b.c', isAdmin: true, 'role; DROP': 1 }), { sets: ['email = $2'], params: ['a@b.c'] });
  assert.deepEqual(setClause(cols, { fullName: 'A', email: 'b@c.d' }), { sets: ['full_name = $2', 'email = $3'], params: ['A', 'b@c.d'] });
  assert.deepEqual(setClause(cols, {}), { sets: [], params: [] });
});

test('translateDbError maps known constraints to field errors and leaves the rest alone', () => {
  const unique = translateDbError({ code: '23505', constraint: 'users_username_key' });
  assert.ok(unique instanceof HttpError);
  assert.equal(unique.status, 409);
  assert.deepEqual(Object.keys(unique.details.fields), ['username']);
  assert.deepEqual(Object.keys(translateDbError({ code: '23505', constraint: 'employees_code_key' }).details.fields), ['employeeCode']);
  assert.equal(translateDbError({ code: '23503', constraint: 'employees_department_id_fkey' }).status, 400);
  assert.deepEqual(Object.keys(translateDbError({ code: '23514', constraint: 'shifts_same_day' }).details.fields), ['endTime']);
  const other = new Error('boom');
  assert.equal(translateDbError(other), other);
  const unknown = { code: '23505', constraint: 'something_else' };
  assert.equal(translateDbError(unknown), unknown);
  assert.equal(validationError({ a: 'x' }).code, 'validation');
  assert.equal(isFkViolation({ code: '23503' }), true);
  assert.equal(isFkViolation(new Error('x')), false);
});

test('diffFields reports only real changes, including arrays', () => {
  const before = { name: 'A', phone: null, workDays: [1, 2] };
  assert.deepEqual(diffFields(before, { name: 'A', phone: null, workDays: [1, 2] }, ['name', 'phone', 'workDays']), {});
  assert.deepEqual(diffFields(before, { name: 'B', phone: '555', workDays: [1, 2, 3] }, ['name', 'phone', 'workDays']),
    { name: { from: 'A', to: 'B' }, phone: { from: null, to: '555' }, workDays: { from: [1, 2], to: [1, 2, 3] } });
  assert.deepEqual(diffFields(before, { name: 'B' }, ['phone']), {}); // unlisted keys are ignored
});

test('holiday schemas (3.7): real dates only, a name is required, update fields are optional, the date conflict is a 409 on `date`', async () => {
  const { holidayCreate, holidayUpdate, holidayListQuery } = await import('../src/services/hrSchemas.js');
  assert.deepEqual(parse(holidayCreate, { date: '2026-11-04', name: '  Midweek  ' }).value, { date: '2026-11-04', name: 'Midweek' });
  for (const bad of [{ name: 'x' }, { date: '2026-11-04' }, { date: '2026-02-30', name: 'x' }, { date: '04/11/2026', name: 'x' }, { date: '2026-11-04', name: '   ' }, { date: '2026-11-04', name: 'x'.repeat(101) }]) {
    assert.ok(parse(holidayCreate, bad).errors, JSON.stringify(bad));
  }
  assert.deepEqual(parse(holidayUpdate, {}).value, {});
  assert.deepEqual(parse(holidayUpdate, { name: 'New' }).value, { name: 'New' });
  assert.ok(parse(holidayUpdate, { date: '2026-13-01' }).errors?.date);
  assert.deepEqual(parse(holidayListQuery, { year: '2026' }, { coerce: true }).value, { year: 2026 });
  assert.ok(parse(holidayListQuery, { year: '1999' }, { coerce: true }).errors?.year);
  const clash = translateDbError({ code: '23505', constraint: 'holidays_date_key' });
  assert.deepEqual([clash.status, Object.keys(clash.details.fields)], [409, ['date']]);
});
