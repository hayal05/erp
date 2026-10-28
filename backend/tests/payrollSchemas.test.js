import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBracketTable, MAX_BRACKETS } from '../src/services/payrollSchemas.js';

const ok = [
  { fromMinor: 0, toMinor: 60000, rate: 0 },
  { fromMinor: 60000, toMinor: 200000, rate: 10, fixedDeductionMinor: 6000 },
  { fromMinor: 200000, toMinor: null, rate: 15.5, fixedDeductionMinor: 15000 },
];

test('a valid table is accepted, defaults the fixed deduction to 0 and orders rows by "from"', () => {
  const { items, errors } = parseBracketTable({ items: [ok[2], ok[0], ok[1]] });
  assert.equal(errors, undefined);
  assert.deepEqual(items.map((b) => b.fromMinor), [0, 60000, 200000]);
  assert.equal(items[0].fixedDeductionMinor, 0);
  assert.equal(items[2].toMinor, null);
});

test('table-level problems are reported (gap, overlap, missing start, missing open end)', () => {
  const msg = (rows) => parseBracketTable({ items: rows }).errors?.items ?? '';
  assert.match(msg([ok[0], { ...ok[1], toMinor: 190000 }, ok[2]]), /gap/);
  assert.match(msg([ok[0], { ...ok[1], toMinor: 210000 }, ok[2]]), /overlap/);
  assert.match(msg([ok[1], ok[2]]), /start at 0/);
  assert.match(msg([ok[0], ok[1]]), /no upper limit/);
});

test('row-level problems name the row and field; money must be whole minor units, rates at most 4 decimals', () => {
  const e = (row) => parseBracketTable({ items: [row] }).errors;
  assert.ok(e({ fromMinor: 0.5, toMinor: null, rate: 5 })['items[0].fromMinor']);
  assert.ok(e({ fromMinor: 0, toMinor: null, rate: 101 })['items[0].rate']);
  assert.ok(e({ fromMinor: 0, toMinor: null, rate: 5.00001 })['items[0].rate']);
  assert.ok(e({ fromMinor: 0, toMinor: null, rate: 5, fixedDeductionMinor: -1 })['items[0].fixedDeductionMinor']);
  assert.ok(e({ fromMinor: 0, toMinor: null })['items[0].rate']);
  assert.ok(e({ fromMinor: 0, toMinor: 0, rate: 5 })['items[0].toMinor']);
});

test('the body shape is checked: a list is required, 1..30 rows, nothing else is accepted', () => {
  for (const body of [undefined, null, {}, { items: 'x' }, { items: [] }, { items: Array(MAX_BRACKETS + 1).fill(ok[0]) }]) {
    assert.ok(parseBracketTable(body).errors?.items, JSON.stringify(body)?.slice(0, 40));
  }
  assert.ok(parseBracketTable({ items: [7] }).errors);
});

// ---- Task 4.6: pension rates and bases
import { parseCalculationSettings } from '../src/services/payrollSchemas.js';

test('calculation settings: only the keys sent are returned, unknown keys are dropped', () => {
  const { changes, errors } = parseCalculationSettings({ employeePensionRate: 7, taxBase: 'basic_plus_taxable_allowance', role: 'hr', roundingMode: 'down' });
  assert.equal(errors, undefined);
  assert.deepEqual(changes, { employeePensionRate: 7, taxBase: 'basic_plus_taxable_allowance' });
});

test('calculation settings: rates 0-100 with at most 4 decimals, zero is allowed', () => {
  assert.deepEqual(parseCalculationSettings({ companyPensionRate: 0 }).changes, { companyPensionRate: 0 });
  assert.deepEqual(parseCalculationSettings({ companyPensionRate: 11.5025 }).changes, { companyPensionRate: 11.5025 });
  for (const bad of [-1, 100.01, 5.00001, '5', NaN, null]) {
    const r = parseCalculationSettings({ employeePensionRate: bad });
    assert.ok(r.errors, String(bad));
  }
});

test('calculation settings: bases must be one of the predefined values (a tax base is not a pension base)', () => {
  assert.ok(parseCalculationSettings({ taxBase: 'gross' }).errors.taxBase);
  assert.ok(parseCalculationSettings({ taxBase: 'basic_plus_pensionable_allowance' }).errors.taxBase);
  assert.ok(parseCalculationSettings({ pensionBase: 'basic_plus_taxable_allowance' }).errors.pensionBase);
  assert.equal(parseCalculationSettings({ pensionBase: 'basic_plus_pensionable_allowance' }).changes.pensionBase, 'basic_plus_pensionable_allowance');
});

test('calculation settings: an empty or non-object body is refused', () => {
  for (const body of [undefined, null, {}, [], 'x', { unknown: 1 }]) assert.ok(parseCalculationSettings(body).errors, JSON.stringify(body));
});

// ---- Task 4.7: other taxes (predefined bases only)
import { readFileSync } from 'node:fs';
import { parseOtherTaxCreate, parseOtherTaxUpdate } from '../src/services/payrollSchemas.js';
import { OTHER_TAX_BASES, computeEntry } from '../src/services/payrollEngine.js';

test('other tax: a valid body is cleaned, enabled defaults to true, unknown keys are dropped', () => {
  const { value, errors } = parseOtherTaxCreate({ name: '  Stamp duty ', rate: 0.5, base: 'gross', id: 9, created_at: 'x' });
  assert.equal(errors, undefined);
  assert.deepEqual(value, { name: 'Stamp duty', rate: 0.5, base: 'gross', enabled: true });
  assert.equal(parseOtherTaxCreate({ name: 'X', rate: 0, base: 'basic', enabled: false }).value.enabled, false);
});

test('other tax: an unknown base is rejected (done-when), as is anything that is not on the fixed list', () => {
  for (const base of ['everything', 'net', 'GROSS', 'gross + 5', '', null, 5, ['gross']]) {
    const r = parseOtherTaxCreate({ name: 'X', rate: 1, base });
    assert.ok(r.errors?.base, `create ${JSON.stringify(base)}`);
  }
  assert.ok(parseOtherTaxUpdate({ base: 'formula' }).errors?.base);
  for (const base of OTHER_TAX_BASES) assert.equal(parseOtherTaxCreate({ name: 'X', rate: 1, base }).value.base, base);
});

test('other tax: name, rate and base are required on create; rate is 0-100 with at most 4 decimals', () => {
  assert.deepEqual(Object.keys(parseOtherTaxCreate({}).errors).sort(), ['base', 'name', 'rate']);
  const bad = (rate) => parseOtherTaxCreate({ name: 'X', base: 'basic', rate }).errors?.rate;
  for (const rate of [-0.01, 100.01, 1.00001, '5', NaN, null]) assert.ok(bad(rate), String(rate));
  assert.equal(bad(0), undefined);
  assert.equal(bad(100), undefined);
  assert.equal(bad(2.5025), undefined);
  assert.ok(parseOtherTaxCreate({ name: '   ', rate: 1, base: 'basic' }).errors.name);
  assert.ok(parseOtherTaxCreate({ name: 'x'.repeat(101), rate: 1, base: 'basic' }).errors.name);
  assert.ok(parseOtherTaxCreate({ name: 'X', rate: 1, base: 'basic', enabled: 'yes' }).errors.enabled);
});

test('other tax: update is partial; an empty or non-object body is refused', () => {
  assert.deepEqual(parseOtherTaxUpdate({ enabled: false }).value, { enabled: false });
  assert.deepEqual(parseOtherTaxUpdate({ rate: 0, role: 'hr' }).value, { rate: 0 });
  assert.ok(parseOtherTaxUpdate({}).errors._);
  assert.ok(parseOtherTaxUpdate({ role: 'hr' }).errors._);
  assert.ok(parseOtherTaxUpdate(undefined).errors._);
  assert.ok(parseOtherTaxUpdate([1]).errors._);
  assert.ok(parseOtherTaxUpdate({ rate: 5.00001 }).errors.rate);
});

test('other tax: the allowed bases are exactly the ones the database CHECK allows (no drift)', () => {
  const sql = readFileSync(new URL('../../database/migrations/004_payroll.sql', import.meta.url), 'utf8');
  const m = sql.match(/CREATE TABLE other_taxes[\s\S]*?base\s+text[^\n]*CHECK \(base IN \(([^)]*)\)\)/);
  assert.ok(m, 'could not find the other_taxes base CHECK');
  const inDb = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(inDb, [...OTHER_TAX_BASES].sort());
});

test('other tax: an accepted body is something the engine computes with (rate x predefined base, summed)', () => {
  const settings = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 5, companyPensionRate: 10, roundingMode: 'half_up' };
  const brackets = [{ fromMinor: 0, toMinor: null, rate: 0, fixedDeductionMinor: 0 }];
  const profile = { basicMinor: 1000000, allowanceMinor: 200000, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true };
  const a = parseOtherTaxCreate({ name: 'On gross', rate: 1, base: 'gross' }).value;
  const b = parseOtherTaxCreate({ name: 'On basic', rate: 2.5, base: 'basic' }).value;
  const off = parseOtherTaxCreate({ name: 'Paused', rate: 50, base: 'gross', enabled: false }).value;
  const e = computeEntry({ settings, brackets, profile, otherTaxes: [a, b, off].map((t, i) => ({ id: i + 1, ...t })) });
  assert.equal(e.otherTaxMinor, 12000 + 25000); // 1% of 1,200,000 gross + 2.5% of 1,000,000 basic; the disabled one adds nothing
});

// ---- Task 4.8a: deduction items
import { parseDeductionCreate, parseDeductionUpdate, deductionListQuery, DEDUCTION_ITEM_KINDS } from '../src/services/payrollSchemas.js';
import { parse } from '../src/middleware/validate.js';
import { DEDUCTION_KINDS } from '../src/services/payrollEngine.js';

test('deduction: a valid body is cleaned, defaults are one-time + enabled, unknown keys are dropped', () => {
  const { value, errors } = parseDeductionCreate({ employeeId: 3, kind: 'loan', name: '  Bike loan ', amountMinor: 150000, appliedPeriodId: 9, id: 1 });
  assert.equal(errors, undefined);
  assert.deepEqual(value, { employeeId: 3, kind: 'loan', name: 'Bike loan', amountMinor: 150000, recurring: false, enabled: true });
  const r = parseDeductionCreate({ employeeId: 3, kind: 'other', name: 'X', amountMinor: 1, recurring: true, enabled: false }).value;
  assert.equal(r.recurring, true);
  assert.equal(r.enabled, false);
});

test('deduction: employeeId, kind, name and amountMinor are required on create', () => {
  assert.deepEqual(Object.keys(parseDeductionCreate({}).errors).sort(), ['amountMinor', 'employeeId', 'kind', 'name']);
  assert.ok(parseDeductionCreate(undefined).errors.employeeId);
  assert.ok(parseDeductionCreate({ employeeId: 0, kind: 'loan', name: 'X', amountMinor: 5 }).errors.employeeId);
});

test('deduction: the amount must be a positive whole number of minor units', () => {
  const bad = (amountMinor) => parseDeductionCreate({ employeeId: 1, kind: 'loan', name: 'X', amountMinor }).errors?.amountMinor;
  for (const a of [0, -1, 1.5, '100', NaN, null, 10_000_000_000_000]) assert.ok(bad(a), String(a));
  assert.equal(bad(1), undefined);
  assert.equal(bad(9_999_999_999_999), undefined);
});

test('deduction: kind is one of the four HR kinds; the attendance kinds cannot be entered', () => {
  for (const kind of ['absence', 'unpaid_leave', 'bonus', 'LOAN', '', null, 5]) {
    assert.ok(parseDeductionCreate({ employeeId: 1, kind, name: 'X', amountMinor: 5 }).errors?.kind, String(kind));
  }
  assert.ok(parseDeductionUpdate({ kind: 'absence' }).errors.kind);
  for (const kind of DEDUCTION_ITEM_KINDS) assert.equal(parseDeductionCreate({ employeeId: 1, kind, name: 'X', amountMinor: 5 }).value.kind, kind);
  assert.deepEqual([...DEDUCTION_ITEM_KINDS], DEDUCTION_KINDS.slice(0, 4)); // the engine accepts every kind HR can enter
});

test('deduction: name is 1-100 characters after trimming; flags must be booleans', () => {
  const base = { employeeId: 1, kind: 'other', amountMinor: 5 };
  assert.ok(parseDeductionCreate({ ...base, name: '   ' }).errors.name);
  assert.ok(parseDeductionCreate({ ...base, name: 'x'.repeat(101) }).errors.name);
  assert.equal(parseDeductionCreate({ ...base, name: 'x'.repeat(100) }).errors, undefined);
  assert.ok(parseDeductionCreate({ ...base, name: 'X', recurring: 'yes' }).errors.recurring);
  assert.ok(parseDeductionCreate({ ...base, name: 'X', enabled: 1 }).errors.enabled);
});

test('deduction: update is partial, cannot move the item to another employee, and refuses an empty body', () => {
  assert.deepEqual(parseDeductionUpdate({ enabled: false }).value, { enabled: false });
  assert.deepEqual(parseDeductionUpdate({ amountMinor: 7, employeeId: 99, id: 4 }).value, { amountMinor: 7 });
  assert.ok(parseDeductionUpdate({}).errors._);
  assert.ok(parseDeductionUpdate({ employeeId: 2 }).errors._);
  assert.ok(parseDeductionUpdate(undefined).errors._);
  assert.ok(parseDeductionUpdate({ amountMinor: 0 }).errors.amountMinor);
});

test('deduction: the list query needs a valid employeeId', () => {
  assert.ok(parse(deductionListQuery, {}, { coerce: true }).errors.employeeId);
  assert.ok(parse(deductionListQuery, { employeeId: '0' }, { coerce: true }).errors.employeeId);
  assert.equal(parse(deductionListQuery, { employeeId: '12' }, { coerce: true }).value.employeeId, 12);
});

test('deduction: the allowed kinds are exactly the ones the database CHECK allows (no drift)', () => {
  const sql = readFileSync(new URL('../../database/migrations/004_payroll.sql', import.meta.url), 'utf8');
  const m = sql.match(/CREATE TABLE deduction_items[\s\S]*?kind\s+text[^\n]*CHECK \(kind IN \(([^)]*)\)\)/);
  assert.ok(m, 'could not find the deduction_items kind CHECK');
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), [...DEDUCTION_ITEM_KINDS].sort());
});

test('deduction: an accepted body is something the engine computes with (flat amounts summed into one column)', () => {
  const settings = { taxBase: 'basic', pensionBase: 'basic', employeePensionRate: 0, companyPensionRate: 0, roundingMode: 'half_up' };
  const brackets = [{ fromMinor: 0, toMinor: null, rate: 0, fixedDeductionMinor: 0 }];
  const profile = { basicMinor: 1000000, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true };
  const items = [{ kind: 'advance', name: 'Advance', amountMinor: 20000 }, { kind: 'penalty', name: 'Late fee', amountMinor: 5050 }]
    .map((b, i) => ({ id: i + 1, ...parseDeductionCreate({ employeeId: 1, ...b }).value }));
  const e = computeEntry({ settings, brackets, profile, deductions: items.map((d) => ({ kind: d.kind, label: d.name, amountMinor: d.amountMinor, sourceId: d.id })) });
  assert.equal(e.otherDeductionsMinor, 25050);
  assert.equal(e.netMinor, 1000000 - 25050);
});
