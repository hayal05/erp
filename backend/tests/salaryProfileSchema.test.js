import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalaryProfile, toSalaryProfile } from '../src/services/salaryProfiles.js';
test('salary profile accepts minor units, zero and false flags; strips ownership', () => {
  assert.deepEqual(parseSalaryProfile({ basicMinor: 250050, allowanceMinor: 0, employeeId: 99, pensionApplies: false }).value, { basicMinor: 250050, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: false });
});
test('salary profile rejects invalid money and flags', () => {
  for (const bad of [-1, 1.5, '100', 10000000000000]) assert.ok(parseSalaryProfile({ basicMinor: bad, allowanceMinor: 0 }).errors.basicMinor);
  assert.ok(parseSalaryProfile({ allowanceMinor: 0 }).errors.basicMinor);
  assert.ok(parseSalaryProfile({ basicMinor: 0, allowanceMinor: 0, pensionApplies: 'false' }).errors.pensionApplies);
});
test('profile maps pg bigint values and distinguishes unsaved defaults', () => {
  assert.equal(toSalaryProfile(null, 4).saved, false);
  assert.equal(toSalaryProfile({ employee_id: '4', basic_minor: '250050', allowance_minor: '0' }).basicMinor, 250050);
});
