import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_POSITION, allowanceNote, buildPosition, deletePositionView, editNotice, monthlyTotal, positionChanged, positionForm, positionRow, positionServerFields, validatePosition } from '../src/pages/positionForm.js';
import { departmentIdFromParam } from '../src/pages/departmentView.js';

const POS = { id: 7, departmentId: 3, name: 'Accountant', basicMinor: 1500000, allowanceMinor: 250050, allowanceTaxable: true, allowancePensionable: false, pensionApplies: true, employeeCount: 0 };
const form = (o = {}) => ({ ...positionForm(POS), ...o });

test('a new position starts empty: name and basic salary are required, allowance 0, all flags on', () => {
  assert.deepEqual(validatePosition(EMPTY_POSITION), { name: 'Give the position a name', basic: 'Enter the basic salary (0 is allowed)' });
  assert.equal(EMPTY_POSITION.allowance, '0');
  assert.deepEqual([EMPTY_POSITION.allowanceTaxable, EMPTY_POSITION.allowancePensionable, EMPTY_POSITION.pensionApplies], [true, true, true]);
});

test('validation: name length after trimming, money rules shared with the salary dialog', () => {
  assert.ok(validatePosition({ ...EMPTY_POSITION, name: 'x'.repeat(101), basic: '1' }).name);
  assert.deepEqual(validatePosition({ ...EMPTY_POSITION, name: ` ${'x'.repeat(100)} `, basic: '0' }), {});
  assert.match(validatePosition(form({ basic: 'abc' })).basic, /Enter an amount/);
  assert.match(validatePosition(form({ basic: '-5' })).basic, /negative/);
  assert.match(validatePosition(form({ allowance: '1.234' })).allowance, /decimal/);
  assert.deepEqual(validatePosition(form({ basic: '2,500.50', allowance: '0' })), {});
  assert.ok(validatePosition(form({ allowance: '' })).allowance); // an empty allowance is not silently 0: type 0
});

test('the body is the full replacement the server expects: trimmed name, minor units, three flags, no extras', () => {
  assert.deepEqual(buildPosition(form({ name: '  Senior accountant ', basic: '2,500.50', allowance: '100' })), {
    name: 'Senior accountant', basicMinor: 250050, allowanceMinor: 10000, allowanceTaxable: true, allowancePensionable: false, pensionApplies: true,
  });
  assert.throws(() => buildPosition(form({ basic: 'x' })));
});

test('an unchanged form is detected, in any spelling of the same amounts; every field counts as a change', () => {
  assert.equal(positionChanged(positionForm(POS), POS), false);
  assert.equal(positionChanged(form({ basic: '15000.00', name: ' Accountant ' }), POS), false);
  assert.equal(positionChanged(form({ name: 'Accountant II' }), POS), true);
  assert.equal(positionChanged(form({ basic: '15000.01' }), POS), true);
  assert.equal(positionChanged(form({ allowance: '2500' }), POS), true);
  assert.equal(positionChanged(form({ allowanceTaxable: false }), POS), true);
  assert.equal(positionChanged(form({ allowancePensionable: true }), POS), true);
  assert.equal(positionChanged(form({ pensionApplies: false }), POS), true);
});

test('server field names map back onto the form inputs', () => {
  assert.deepEqual(positionServerFields({ name: 'Already exists', basicMinor: 'Too large' }), { name: 'Already exists', basic: 'Too large' });
  assert.deepEqual(positionServerFields({ allowanceMinor: 'x' }), { allowance: 'x' });
  assert.deepEqual(positionServerFields(undefined), {});
});

test('table rows show exact money and a plain-language allowance note', () => {
  assert.deepEqual(positionRow(POS), { id: 7, name: 'Accountant', basic: '15,000.00', allowance: '2,500.50', allowanceNote: 'Taxable, not pensionable', pension: 'Yes', employees: 0 });
  const none = positionRow({ ...POS, allowanceMinor: 0, pensionApplies: false, employeeCount: 4 });
  assert.equal(none.allowanceNote, '');
  assert.equal(none.pension, 'No');
  assert.equal(none.employees, 4);
  assert.equal(allowanceNote({ ...POS, allowanceTaxable: false, allowancePensionable: true }), 'Not taxable, pensionable');
  assert.equal(positionRow({ ...POS, employeeCount: undefined }).employees, 0);
});

test('the monthly total is exact and blank while an amount is not valid', () => {
  assert.equal(monthlyTotal({ basic: '1,000.10', allowance: '0.20' }), '1,000.30'); // no float drift
  assert.equal(monthlyTotal({ basic: '', allowance: '0' }), '');
  assert.equal(monthlyTotal({ basic: '5', allowance: 'x' }), '');
});

test('delete is blocked while anyone holds the position, with the count in the message', () => {
  const held = deletePositionView({ ...POS, employeeCount: 1 });
  assert.equal(held.blocked, true);
  assert.match(held.message, /1 employee,/);
  assert.match(held.message, /inactive/);
  assert.match(deletePositionView({ ...POS, employeeCount: 3 }).message, /3 employees/);
  const free = deletePositionView(POS);
  assert.equal(free.blocked, false);
  assert.match(free.message, /keep the salary/);
});

test('the dialog says editing does not touch current employees, and that a rename updates their job title', () => {
  assert.match(editNotice(null), /does not change employees who already have this position/);
  assert.doesNotMatch(editNotice(POS), /job title/);
  assert.match(editNotice({ ...POS, employeeCount: 2 }), /job title of 2 employees/);
});

test('the department id in the address must be a plain positive whole number', () => {
  assert.equal(departmentIdFromParam('12'), 12);
  for (const bad of ['0', '-1', '1.5', '01', 'abc', '', ' 5', '5 ', '1e3', '9'.repeat(16), undefined, null]) assert.equal(departmentIdFromParam(bad), null, String(bad));
});

// ---- Task 6.11: money conversion
import { formatMoney } from '../src/api/money.js';

test('money in the position form is exact: what is typed becomes the same number of minor units, with no float drift', () => {
  for (const [typed, minor] of [['0', 0], ['0.01', 1], ['0.1', 10], ['19.99', 1999], ['1,234.50', 123450], ['1234.5', 123450], ['10', 1000], ['99,999,999,999.99', 9999999999999]]) {
    assert.equal(buildPosition({ ...EMPTY_POSITION, name: 'A', basic: typed }).basicMinor, minor, typed);
  }
  // every cent amount survives type -> store -> show -> type again unchanged
  for (const minor of [0, 1, 99, 100, 101, 12345, 99999, 100000, 250050, 1234567, 9999999999999]) {
    const shown = formatMoney(minor);
    assert.equal(buildPosition({ ...EMPTY_POSITION, name: 'A', basic: shown }).basicMinor, minor, shown);
    assert.equal(positionForm({ ...POS, basicMinor: minor }).basic, shown);
  }
});

test('money errors are readable and the ceiling is the database limit', () => {
  assert.match(validatePosition(form({ basic: '100,000,000,000.00' })).basic, /too large/);
  assert.match(validatePosition(form({ basic: '1.2.3' })).basic, /Enter an amount/);
  assert.match(validatePosition(form({ basic: '1,23' })).basic, /Enter an amount/);
  assert.match(validatePosition(form({ allowance: '-0.01' })).allowance, /negative/);
  assert.deepEqual(validatePosition(form({ basic: '99,999,999,999.99' })), {});
});
