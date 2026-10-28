import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalcPatch, buildDeductionCreate, buildDeductionPatch, buildOtherTaxCreate, buildOtherTaxPatch, baseOptions, calcChanged, calcForm,
  deductionForm, deductionKindLabel, deductionStatus, deductionTone, employeeFromParam, employeeLabel, EMPTY_DEDUCTION, EMPTY_OTHER_TAX, isConsumed, otherTaxForm, otherTaxLine, serverDeductionErrors,
  validateCalcForm, validateDeduction, validateOtherTax } from '../src/pages/payrollSettingsView.js';

const SETTINGS = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 7, companyPensionRate: 11 };
const BASES = ['gross', 'basic', 'taxable_income', 'pensionable'];

test('calc form: shows saved values and sends only what changed', () => {
  const f = calcForm(SETTINGS);
  assert.deepEqual(f, { employeePensionRate: '7', companyPensionRate: '11', taxBase: 'basic', pensionBase: 'basic' });
  assert.deepEqual(buildCalcPatch(f, SETTINGS), {});
  assert.equal(calcChanged(f, SETTINGS), false);
  assert.deepEqual(buildCalcPatch({ ...f, employeePensionRate: '7.0' }, SETTINGS), {}, '7.0 is not a change');
  assert.deepEqual(buildCalcPatch({ ...f, employeePensionRate: '8.5', pensionBase: 'basic_plus_pensionable_allowance' }, SETTINGS),
    { employeePensionRate: 8.5, pensionBase: 'basic_plus_pensionable_allowance' });
  assert.deepEqual(buildCalcPatch({ ...f, companyPensionRate: '0' }, SETTINGS), { companyPensionRate: 0 }, 'zero is a real value');
  assert.equal(calcChanged({ ...f, taxBase: 'basic_plus_taxable_allowance' }, SETTINGS), true);
});

test('calc form: rates 0-100 with 4 decimals, bases only from their own lists', () => {
  const f = calcForm(SETTINGS);
  assert.deepEqual(validateCalcForm(f), {});
  for (const bad of ['', '101', '-1', 'x', '1.23456']) assert.ok(validateCalcForm({ ...f, employeePensionRate: bad }).employeePensionRate, bad);
  assert.ok(validateCalcForm({ ...f, companyPensionRate: '' }).companyPensionRate);
  assert.ok(validateCalcForm({ ...f, taxBase: 'basic_plus_pensionable_allowance' }).taxBase, 'a pension base is not a tax base');
  assert.ok(validateCalcForm({ ...f, pensionBase: 'basic_plus_taxable_allowance' }).pensionBase);
  assert.equal(calcChanged({ ...f, employeePensionRate: 'abc' }, SETTINGS), true, 'an invalid form is never "unchanged"');
});

test('other tax form: base comes from the server list, rate is a percentage', () => {
  assert.deepEqual(baseOptions(BASES).map((o) => o.label), ['Gross salary', 'Basic salary', 'Taxable income', 'Pensionable salary']);
  assert.deepEqual(baseOptions(['future_base']), [{ value: 'future_base', label: 'future_base' }]);
  assert.deepEqual(Object.keys(validateOtherTax(EMPTY_OTHER_TAX, BASES)).sort(), ['base', 'name', 'rate']);
  const ok = { name: ' Cost sharing ', rate: '5.5', base: 'gross', enabled: true };
  assert.deepEqual(validateOtherTax(ok, BASES), {});
  assert.ok(validateOtherTax({ ...ok, base: 'x * 2' }, BASES).base, 'a formula is not a base');
  assert.ok(validateOtherTax({ ...ok, name: 'a'.repeat(101) }, BASES).name);
  assert.ok(validateOtherTax({ ...ok, rate: '100.5' }, BASES).rate);
  assert.deepEqual(buildOtherTaxCreate(ok), { name: 'Cost sharing', rate: 5.5, base: 'gross', enabled: true });
});

test('other tax edit: changed-only patch, no-op is empty', () => {
  const t = { id: 3, name: 'Cost sharing', rate: 5, base: 'gross', enabled: true };
  const f = otherTaxForm(t);
  assert.deepEqual(f, { name: 'Cost sharing', rate: '5', base: 'gross', enabled: true });
  assert.deepEqual(buildOtherTaxPatch(f, t), {});
  assert.deepEqual(buildOtherTaxPatch({ ...f, name: ' Cost sharing ', rate: '5.00' }, t), {});
  assert.deepEqual(buildOtherTaxPatch({ ...f, enabled: false, base: 'basic' }, t), { enabled: false, base: 'basic' });
  assert.deepEqual(buildOtherTaxPatch({ ...f, rate: '0' }, t), { rate: 0 });
  assert.equal(otherTaxLine(t), '5% of gross salary');
  assert.equal(otherTaxLine({ ...t, enabled: false }), '5% of gross salary (paused)');
});

test('deduction form: kinds, amount above zero, whole minor units', () => {
  assert.deepEqual(Object.keys(validateDeduction(EMPTY_DEDUCTION)).sort(), ['amount', 'name']);
  const ok = { kind: 'loan', name: ' Bank loan ', amount: '1,250.50', recurring: true, enabled: true };
  assert.deepEqual(validateDeduction(ok), {});
  assert.ok(validateDeduction({ ...ok, amount: '0' }).amount, 'zero is refused like the server');
  assert.ok(validateDeduction({ ...ok, amount: '0.00' }).amount);
  assert.equal(validateDeduction({ ...ok, amount: '0.01' }).amount, undefined);
  assert.ok(validateDeduction({ ...ok, amount: '-5' }).amount);
  assert.ok(validateDeduction({ ...ok, kind: 'absence' }).kind, 'absence and unpaid leave are computed, never typed');
  assert.ok(validateDeduction({ ...ok, kind: 'unpaid_leave' }).kind);
  assert.deepEqual(buildDeductionCreate(ok, 42), { employeeId: 42, kind: 'loan', name: 'Bank loan', amountMinor: 125050, recurring: true, enabled: true });
});

test('deduction edit: changed-only patch and consumed items', () => {
  const d = { id: 9, employeeId: 42, kind: 'advance', name: 'Advance', amountMinor: 250000, recurring: false, enabled: true, appliedPeriodId: null };
  const f = deductionForm(d);
  assert.deepEqual(f, { kind: 'advance', name: 'Advance', amount: '2,500.00', recurring: false, enabled: true });
  assert.deepEqual(buildDeductionPatch(f, d), {});
  assert.deepEqual(buildDeductionPatch({ ...f, amount: '2500' }, d), {}, '2500 equals 2,500.00');
  assert.deepEqual(buildDeductionPatch({ ...f, amount: '2,600.05', enabled: false }, d), { amountMinor: 260005, enabled: false });
  assert.equal(isConsumed(d), false);
  assert.equal(isConsumed({ ...d, appliedPeriodId: 5 }), true);
  assert.equal(deductionStatus(d), 'Next payroll');
  assert.equal(deductionStatus({ ...d, recurring: true }), 'Every month');
  assert.equal(deductionStatus({ ...d, enabled: false }), 'Paused');
  assert.equal(deductionStatus({ ...d, appliedPeriodId: 5, enabled: false }), 'Used', 'used wins over paused');
});

test('server errors map back to form field names', () => {
  assert.deepEqual(serverDeductionErrors({ amountMinor: 'Too large', name: 'Required' }), { amount: 'Too large', name: 'Required' });
  assert.deepEqual(serverDeductionErrors(), {});
});

import { PAYROLL_TABS, tabForKey, tabFromParam } from '../src/pages/payrollSettingsView.js';

test('payroll tabs: four, in spec order, unknown ?tab falls back to the first', () => {
  assert.deepEqual(PAYROLL_TABS.map((t) => t.label), ['Income Tax', 'Pension', 'Other Taxes', 'Other Deductions']);
  assert.equal(new Set(PAYROLL_TABS.map((t) => t.key)).size, 4);
  assert.equal(tabFromParam('pension'), 'pension');
  for (const bad of [null, undefined, '', 'PENSION', 'x', '__proto__']) assert.equal(tabFromParam(bad), 'income-tax', String(bad));
  assert.ok(PAYROLL_TABS.filter((t) => t.path).every((t) => t.path.startsWith('/payroll-settings/')));
});

test('payroll tabs: arrow keys wrap, Home/End jump, other keys ignored', () => {
  assert.equal(tabForKey('income-tax', 'ArrowRight'), 'pension');
  assert.equal(tabForKey('other-deductions', 'ArrowRight'), 'income-tax');
  assert.equal(tabForKey('income-tax', 'ArrowLeft'), 'other-deductions');
  assert.equal(tabForKey('pension', 'Home'), 'income-tax');
  assert.equal(tabForKey('pension', 'End'), 'other-deductions');
  assert.equal(tabForKey('pension', 'Enter'), null);
  assert.equal(tabForKey('nonsense', 'ArrowRight'), 'pension');
});

test('deductions tab: labels, tones, employee picker helpers', () => {
  assert.equal(deductionKindLabel('loan'), 'Loan repayment');
  assert.equal(deductionKindLabel('weird'), 'weird');
  const base = { kind: 'advance', enabled: true, recurring: false, appliedPeriodId: null };
  assert.equal(deductionTone(base), 'ok');
  assert.equal(deductionTone({ ...base, enabled: false }), 'warn');
  assert.equal(deductionTone({ ...base, appliedPeriodId: 7 }), 'neutral', 'used beats paused');
  assert.equal(employeeLabel({ employeeCode: 'EMP-001', fullName: 'Abebe Kebede' }), 'EMP-001 · Abebe Kebede');
  assert.equal(employeeLabel({ fullName: 'No Code' }), 'No Code');
  assert.equal(employeeFromParam('12'), '12');
  for (const bad of [null, '', '0', '-3', '1e3', '12abc', '1 OR 1=1', '9'.repeat(30)]) assert.equal(employeeFromParam(bad), '', String(bad));
});
