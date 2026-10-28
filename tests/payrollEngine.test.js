import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEntry, validateBrackets, findBracket, PayrollError } from '../src/services/payrollEngine.js';
import { parseMoney as m } from '../src/services/money.js';

// Illustrative numbers only (nothing statutory is built in).
const brackets = [
  { fromMinor: 0, toMinor: m('600'), rate: 0, fixedDeductionMinor: 0 },
  { fromMinor: m('600'), toMinor: m('2000'), rate: 10, fixedDeductionMinor: m('60') },
  { fromMinor: m('2000'), toMinor: m('5000'), rate: 15, fixedDeductionMinor: m('150') },
  { fromMinor: m('5000'), toMinor: null, rate: 20, fixedDeductionMinor: m('400') },
];
const settings = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 5, companyPensionRate: 10, roundingMode: 'half_up' };
const profile = { basicMinor: m('2500'), allowanceMinor: m('500'), allowanceTaxable: true, allowancePensionable: true, pensionApplies: true };
const run = (over = {}) => computeEntry({ settings, brackets, profile, ...over });

test('#12 the bracket picks the right rate and fixed deduction (2,500 at 15% minus 150 = 225), edges are from <= income < to', () => {
  const r = run();
  assert.equal(r.incomeTaxMinor, m('225'));
  assert.equal(r.incomeTaxRate, 15);
  assert.equal(r.incomeTaxFixedDeductionMinor, m('150'));
  const pick = (income) => findBracket(brackets, income).rate;
  assert.deepEqual([pick(0), pick(m('599.99')), pick(m('600')), pick(m('1999.99')), pick(m('2000')), pick(m('4999.99')), pick(m('5000')), pick(m('90000'))], [0, 0, 10, 10, 15, 15, 20, 20]);
});

test('income tax never goes below zero when the fixed deduction exceeds rate x income', () => {
  const r = run({ profile: { ...profile, basicMinor: m('600'), allowanceMinor: 0 }, brackets: [{ fromMinor: 0, toMinor: null, rate: 10, fixedDeductionMinor: m('100') }] });
  assert.equal(r.incomeTaxMinor, 0); // 60 - 100 -> 0
});

test('#13 employee and company pension are distinct; only the employee share reduces net, only the company share adds to cost', () => {
  const r = run();
  assert.equal(r.employeePensionMinor, m('125')); // 5% of 2,500
  assert.equal(r.employerPensionMinor, m('250')); // 10% of 2,500
  assert.equal(r.netMinor, m('3000') - m('225') - m('125'));
  assert.equal(r.employerCostMinor, m('3000') + m('250'));
  const more = run({ settings: { ...settings, companyPensionRate: 40 } });
  assert.equal(more.netMinor, r.netMinor); // a higher company rate changes cost, never net
  assert.equal(more.employerCostMinor, m('3000') + m('1000'));
});

test('#14 flat deductions are summed into Other Deductions, with the breakdown kept', () => {
  const r = run({ deductions: [
    { kind: 'advance', label: 'Advance', amountMinor: m('200'), sourceId: 7 },
    { kind: 'loan', label: 'Loan', amountMinor: m('150.50'), sourceId: 8 },
    { kind: 'penalty', label: 'Late fine', amountMinor: m('0.50'), sourceId: 9 },
  ] });
  assert.equal(r.otherDeductionsMinor, m('351'));
  assert.deepEqual(r.items.map((i) => [i.kind, i.amountMinor, i.sourceId]), [['advance', 20000, 7], ['loan', 15050, 8], ['penalty', 50, 9]]);
});

test('#15 net salary = gross - income tax - other taxes - employee pension - other deductions (worked example)', () => {
  const otherTaxes = [{ id: 1, name: 'Levy', rate: 2, base: 'gross', enabled: true }, { id: 2, name: 'Off', rate: 50, base: 'gross', enabled: false }];
  const r = run({ otherTaxes, deductions: [{ kind: 'loan', label: 'Loan', amountMinor: m('100'), sourceId: 1 }] });
  // gross 3,000; tax 225; other tax 2% of 3,000 = 60; pension 125; deductions 100 -> 2,490
  assert.equal(r.grossMinor, m('3000'));
  assert.equal(r.otherTaxMinor, m('60'));
  assert.equal(r.netMinor, m('2490'));
  assert.equal(r.employerCostMinor, m('3250'));
  assert.deepEqual(r.items[0], { kind: 'other_tax', label: 'Levy', rate: 2, baseMinor: m('3000'), amountMinor: m('60'), sourceId: 1 });
  assert.equal(r.items.length, 2); // the disabled tax is not applied
});

test('settings choose the bases: allowance flags only matter when the base includes allowances', () => {
  const taxable = run({ settings: { ...settings, taxBase: 'basic_plus_taxable_allowance' } });
  assert.equal(taxable.taxableIncomeMinor, m('3000'));
  assert.equal(taxable.incomeTaxMinor, m('300')); // 15% of 3,000 - 150
  const notTaxable = run({ settings: { ...settings, taxBase: 'basic_plus_taxable_allowance' }, profile: { ...profile, allowanceTaxable: false } });
  assert.equal(notTaxable.taxableIncomeMinor, m('2500'));
  const pens = run({ settings: { ...settings, pensionBase: 'basic_plus_pensionable_allowance' } });
  assert.equal(pens.pensionableMinor, m('3000'));
  assert.equal(pens.employeePensionMinor, m('150'));
  const off = run({ settings: { ...settings, pensionBase: 'basic_plus_pensionable_allowance' }, profile: { ...profile, allowancePensionable: false } });
  assert.equal(off.pensionableMinor, m('2500'));
});

test('an employee without pension has no pensionable base and neither share', () => {
  const r = run({ profile: { ...profile, pensionApplies: false }, otherTaxes: [{ name: 'P', rate: 10, base: 'pensionable', enabled: true }] });
  assert.equal(r.pensionableMinor, 0);
  assert.equal(r.employeePensionMinor, 0);
  assert.equal(r.employerPensionMinor, 0);
  assert.equal(r.otherTaxMinor, 0);
  assert.equal(r.employerCostMinor, r.grossMinor);
});

test('every other-tax base is applied to the right amount', () => {
  const taxes = ['gross', 'basic', 'taxable_income', 'pensionable'].map((base, i) => ({ id: i, name: base, rate: 10, base, enabled: true }));
  const r = run({ otherTaxes: taxes });
  assert.deepEqual(r.items.map((i) => i.baseMinor), [m('3000'), m('2500'), m('2500'), m('2500')]);
  assert.throws(() => run({ otherTaxes: [{ name: 'X', rate: 1, base: 'revenue / 2', enabled: true }] }), { code: 'invalid_input' });
});

test('rounding: each line is rounded once with the configured mode (no float drift)', () => {
  const p = { ...profile, basicMinor: 1001, allowanceMinor: 0 }; // 10.01
  const rate = (mode) => computeEntry({ settings: { ...settings, employeePensionRate: 50, companyPensionRate: 50, roundingMode: mode }, brackets, profile: p }).employeePensionMinor;
  assert.deepEqual(['half_up', 'half_even', 'down', 'up'].map(rate), [501, 500, 500, 501]); // 500.5 minor units
  const r = computeEntry({ settings: { ...settings, employeePensionRate: 33.3333 }, brackets, profile: { ...profile, basicMinor: 1, allowanceMinor: 0 } });
  assert.equal(r.employeePensionMinor, 0);
});

test('the identities hold for many generated inputs (and the DB CHECKs would accept the row)', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 500; i++) {
    const prof = { basicMinor: rnd(2_000_000), allowanceMinor: rnd(500_000), allowanceTaxable: rnd(2) === 1, allowancePensionable: rnd(2) === 1, pensionApplies: rnd(5) > 0 };
    const st = { ...settings, taxBase: rnd(2) ? 'basic' : 'basic_plus_taxable_allowance', pensionBase: rnd(2) ? 'basic' : 'basic_plus_pensionable_allowance', roundingMode: ['half_up', 'half_even', 'down', 'up'][rnd(4)], employeePensionRate: rnd(1000) / 10, companyPensionRate: rnd(1000) / 10 };
    const r = computeEntry({ settings: st, brackets, profile: prof, otherTaxes: [{ name: 'T', rate: rnd(100), base: 'gross', enabled: true }], deductions: rnd(2) ? [{ kind: 'loan', label: 'L', amountMinor: 1 + rnd(1000) }] : [] });
    assert.equal(r.grossMinor, prof.basicMinor + prof.allowanceMinor);
    assert.equal(r.netMinor, r.grossMinor - r.incomeTaxMinor - r.otherTaxMinor - r.employeePensionMinor - r.otherDeductionsMinor);
    assert.equal(r.employerCostMinor, r.grossMinor + r.employerPensionMinor);
    for (const k of ['incomeTaxMinor', 'otherTaxMinor', 'employeePensionMinor', 'employerPensionMinor', 'otherDeductionsMinor']) assert.ok(Number.isSafeInteger(r[k]) && r[k] >= 0);
  }
});

test('bracket validation reports gaps, overlaps, a missing start, a missing open end and empty tables', () => {
  assert.deepEqual(validateBrackets(brackets), []);
  assert.match(validateBrackets([])[0], /No income tax brackets/);
  assert.match(validateBrackets(brackets.slice(1)).join(), /start at 0/);
  assert.match(validateBrackets(brackets.slice(0, 3)).join(), /no upper limit/);
  const gap = brackets.map((b, i) => (i === 1 ? { ...b, toMinor: m('1900') } : b));
  assert.match(validateBrackets(gap).join(), /gap between brackets 2 and 3/);
  const overlap = brackets.map((b, i) => (i === 1 ? { ...b, toMinor: m('2100') } : b));
  assert.match(validateBrackets(overlap).join(), /overlap/);
  assert.match(validateBrackets([{ fromMinor: 0, toMinor: null, rate: 101, fixedDeductionMinor: 0 }]).join(), /rate/);
  assert.match(validateBrackets([{ fromMinor: 0, toMinor: null, rate: 5, fixedDeductionMinor: -1 }]).join(), /negative/);
});

test('invalid brackets block the calculation instead of producing zero tax', () => {
  assert.throws(() => run({ brackets: brackets.slice(1) }), (e) => e instanceof PayrollError && e.code === 'invalid_brackets');
  assert.throws(() => run({ brackets: [] }), { code: 'invalid_brackets' });
});

test('bad input is refused with a clear code', () => {
  assert.throws(() => run({ profile: { ...profile, basicMinor: 10.5 } }), { code: 'invalid_input' });
  assert.throws(() => run({ profile: { ...profile, basicMinor: -1 } }), { code: 'invalid_input' });
  assert.throws(() => run({ settings: { ...settings, taxBase: 'gross' } }), { code: 'invalid_input' });
  assert.throws(() => run({ settings: { ...settings, employeePensionRate: 5.00001 } }), { code: 'invalid_input' });
  assert.throws(() => run({ settings: { ...settings, roundingMode: 'nearest' } }), { code: 'invalid_input' });
  assert.throws(() => run({ deductions: [{ kind: 'loan', label: 'x', amountMinor: 0 }] }), { code: 'invalid_input' });
  assert.throws(() => run({ deductions: [{ kind: 'bonus', label: 'x', amountMinor: 5 }] }), { code: 'invalid_input' });
});

test('net can be negative (deductions above pay) and is reported as such; attendance deductions are ordinary items', () => {
  const r = run({ deductions: [{ kind: 'absence', label: 'Absence (3 days)', amountMinor: m('5000') }, { kind: 'unpaid_leave', label: 'Unpaid leave', amountMinor: m('1') }] });
  assert.ok(r.netMinor < 0);
  assert.equal(r.otherDeductionsMinor, m('5001'));
  assert.deepEqual(r.items.map((i) => i.kind), ['absence', 'unpaid_leave']);
});
