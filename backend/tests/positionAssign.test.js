// Task 6.5: the pure parts of "employee create/update applies the position package" (no database needed).
// The database-backed flows are covered in task 6.6 (positions.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
const { parse } = await import('../src/middleware/validate.js');
const { employeeCreate, employeeUpdate } = await import('../src/services/hrSchemas.js');
const { loadAssignablePosition } = await import('../src/services/positions.js');
const { translateDbError } = await import('../src/services/dbErrors.js');
const { HttpError } = await import('../src/middleware/error.js');

const goodEmployee = { gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',employeeCode: 'EMP-001', fullName: 'Abebe Kebede', username: 'a@natra.test', email: 'a@natra.test', startDate: '2026-01-15', password: 'a-long-password' };

test('create accepts positionId (or null) and never reads salary figures or applyPositionSalary', () => {
  const ok = parse(employeeCreate, { ...goodEmployee, positionId: 7, basicMinor: 999, allowanceMinor: 5, applyPositionSalary: false });
  assert.equal(ok.errors, null);
  assert.equal(ok.value.positionId, 7);
  for (const key of ['basicMinor', 'allowanceMinor', 'applyPositionSalary']) assert.equal(key in ok.value, false, key);
  assert.equal(parse(employeeCreate, { ...goodEmployee, positionId: null }).value.positionId, null);
  assert.equal('positionId' in parse(employeeCreate, goodEmployee).value, false);
  for (const bad of [0, -1, 1.5, '7x']) assert.deepEqual(Object.keys(parse(employeeCreate, { ...goodEmployee, positionId: bad }).errors), ['positionId'], String(bad));
});

test('update: positionId and applyPositionSalary are optional, omitted means unchanged, and the flag must be a real boolean', () => {
  assert.deepEqual(parse(employeeUpdate, {}).value, {});
  assert.deepEqual(parse(employeeUpdate, { positionId: 3, applyPositionSalary: true }).value, { positionId: 3, applyPositionSalary: true });
  assert.deepEqual(parse(employeeUpdate, { positionId: null }).value, { positionId: null });
  assert.deepEqual(parse(employeeUpdate, { applyPositionSalary: false }).value, { applyPositionSalary: false });
  for (const bad of ['true', 1, 'yes']) assert.deepEqual(Object.keys(parse(employeeUpdate, { applyPositionSalary: bad }).errors), ['applyPositionSalary'], String(bad));
});

const fakeDb = (row) => ({ calls: [], async query(sql, params) { this.calls.push({ sql, params }); return { rows: row ? [row] : [] }; } });
const POSITION_ROW = { id: '5', department_id: '2', name: 'Cashier', basic_minor: '500000', allowance_minor: '100000',
  allowance_taxable: true, allowance_pensionable: false, pension_applies: true };

test('loadAssignablePosition returns the package and locks the position row FOR SHARE', async () => {
  const db = fakeDb(POSITION_ROW);
  const p = await loadAssignablePosition(db, 5, 2);
  assert.deepEqual(p, { id: 5, departmentId: 2, name: 'Cashier', basicMinor: 500000, allowanceMinor: 100000, allowanceTaxable: true, allowancePensionable: false, pensionApplies: true });
  assert.match(db.calls[0].sql, /FOR SHARE/);
  assert.equal((await loadAssignablePosition(fakeDb(POSITION_ROW), 5, '2')).id, 5); // department given as text still matches
});

test('loadAssignablePosition: unknown position is 400, another department or no department is 422, both on field positionId', async () => {
  const missing = await loadAssignablePosition(fakeDb(null), 5, 2).catch((e) => e);
  assert.deepEqual([missing.status, Object.keys(missing.details.fields)], [400, ['positionId']]);
  for (const department of [3, null]) {
    const err = await loadAssignablePosition(fakeDb(POSITION_ROW), 5, department).catch((e) => e);
    assert.ok(err instanceof HttpError);
    assert.deepEqual([err.status, err.code, Object.keys(err.details.fields)], [422, 'validation', ['positionId']], String(department));
  }
});

test('database backstops for a mismatched or department-less position are 422 on positionId, not 500', () => {
  for (const [code, constraint] of [['23503', 'employees_position_department_fkey'], ['23514', 'employees_position_needs_department']]) {
    const err = translateDbError({ code, constraint });
    assert.deepEqual([err.status, Object.keys(err.details.fields)], [422, ['positionId']], constraint);
  }
  const unrelated = { code: '23503', constraint: 'something_else_fkey' };
  assert.equal(translateDbError(unrelated), unrelated);
});
