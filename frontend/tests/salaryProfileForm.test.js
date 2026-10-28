import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileForm, profilePayload } from '../src/pages/salaryProfileForm.js';
test('salary form round trips exact amounts and false flags', () => {
  const p = { basicMinor: 250050, allowanceMinor: 0, allowanceTaxable: false, allowancePensionable: false, pensionApplies: true };
  assert.equal(profileForm(p).basic, '2,500.50');
  assert.deepEqual(profilePayload(profileForm(p)), { value: p });
});
test('salary form highlights invalid money', () => {
  assert.deepEqual(Object.keys(profilePayload({ basic: '-1', allowance: '2.555' }).errors), ['basic', 'allowance']);
});
