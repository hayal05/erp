import { parse, v } from '../middleware/validate.js';
import { validateBrackets, TAX_BASES, PENSION_BASES, OTHER_TAX_BASES } from './payrollEngine.js';
import { MAX_MINOR, rateToScaled } from './money.js';

// Request shapes for the payroll settings API (kept free of Express/pg so they are unit-testable). Money is sent as whole
// MINOR units (the browser converts '2,500.50' <-> 250050 with its own formatter); rates are percentages with <= 4 decimals.
export const MAX_BRACKETS = 30;

const bracketRow = {
  fromMinor: v.int({ required: true, min: 0, max: MAX_MINOR }),
  toMinor: v.int({ nullable: true, min: 1, max: MAX_MINOR }),
  rate: v.number({ required: true, min: 0, max: 100 }),
  fixedDeductionMinor: v.int({ min: 0, max: MAX_MINOR, default: 0 }),
};

// Body of PUT /brackets: { items: [...] } -> { items } cleaned and ordered by "from", or { errors } as field -> message.
// The whole table is replaced at once because a gap or overlap is a property of the table, never of one row.
export function parseBracketTable(body) {
  const list = body && typeof body === 'object' ? body.items : undefined;
  if (!Array.isArray(list)) return { errors: { items: 'Send the full list of brackets' } };
  if (list.length === 0 || list.length > MAX_BRACKETS) return { errors: { items: `Send between 1 and ${MAX_BRACKETS} brackets` } };
  const errors = {};
  const items = [];
  list.forEach((row, i) => {
    const { value, errors: e } = parse(bracketRow, row);
    if (e) { for (const [k, msg] of Object.entries(e)) errors[`items[${i}].${k}`] = msg; return; }
    try { rateToScaled(value.rate); } catch { errors[`items[${i}].rate`] = 'At most 4 decimals'; return; }
    items.push({ ...value, toMinor: value.toMinor ?? null });
  });
  if (Object.keys(errors).length) return { errors };
  items.sort((a, b) => a.fromMinor - b.fromMinor);
  const problems = validateBrackets(items);
  if (problems.length) return { errors: { items: problems.join('. ') } };
  return { items };
}

// Body of PATCH /calculation (task 4.6): pension rates plus the two bases (spec 13, 14). Partial: an omitted key is left
// unchanged, unknown keys are dropped. Returns { changes } (only the keys sent) or { errors } as field -> message.
const calculationRow = {
  taxBase: v.enum({ values: TAX_BASES }),
  pensionBase: v.enum({ values: PENSION_BASES }),
  employeePensionRate: v.number({ min: 0, max: 100 }),
  companyPensionRate: v.number({ min: 0, max: 100 }),
};
export const CALCULATION_KEYS = Object.keys(calculationRow);

export function parseCalculationSettings(body) {
  const { value, errors } = parse(calculationRow, body);
  if (errors) return { errors };
  for (const key of ['employeePensionRate', 'companyPensionRate']) {
    if (value[key] === undefined) continue;
    try { rateToScaled(value[key]); } catch { return { errors: { [key]: 'At most 4 decimals' } }; }
  }
  if (Object.keys(value).length === 0) return { errors: { _: `Send at least one of: ${CALCULATION_KEYS.join(', ')}` } };
  return { changes: value };
}

// Bodies of POST / PATCH /other-taxes (task 4.7, spec 15): a name, a percentage and a base chosen from the engine's fixed list
// (OTHER_TAX_BASES), never a formula. Create needs name, rate and base (enabled defaults to true); update is partial, unknown keys
// are dropped. Both return { value } or { errors } as field -> message.
const otherTaxFields = {
  name: v.string({ max: 100 }),
  rate: v.number({ min: 0, max: 100 }),
  base: v.enum({ values: OTHER_TAX_BASES }),
  enabled: v.boolean(),
};
export const OTHER_TAX_KEYS = Object.keys(otherTaxFields);
const otherTaxCreate = { ...otherTaxFields,
  name: v.string({ required: true, max: 100 }), rate: v.number({ required: true, min: 0, max: 100 }),
  base: v.enum({ required: true, values: OTHER_TAX_BASES }), enabled: v.boolean({ default: true }) };

function otherTaxRow(schema, body) {
  const { value, errors } = parse(schema, body ?? {});
  if (errors) return { errors };
  if (value.rate !== undefined) {
    try { rateToScaled(value.rate); } catch { return { errors: { rate: 'At most 4 decimals' } }; }
  }
  return { value };
}
export const parseOtherTaxCreate = (body) => otherTaxRow(otherTaxCreate, body);
export function parseOtherTaxUpdate(body) {
  const out = otherTaxRow(otherTaxFields, body);
  if (out.errors) return out;
  if (Object.keys(out.value).length === 0) return { errors: { _: `Send at least one of: ${OTHER_TAX_KEYS.join(', ')}` } };
  return out;
}

// Bodies of POST / PATCH /api/deductions (task 4.8a, spec 16): a flat amount taken from one employee's pay. `kind` is one of the
// four HR-entered kinds (absence / unpaid_leave are computed by payroll itself, 4.15, and can never be entered here). Money is whole
// minor units > 0. Create needs employeeId, kind, name and amountMinor (recurring defaults to false = one-time, enabled to true);
// update is partial, unknown keys are dropped, and employeeId cannot be changed (an item belongs to one person for good).
export const DEDUCTION_ITEM_KINDS = Object.freeze(['advance', 'loan', 'penalty', 'other']);
const deductionFields = {
  kind: v.enum({ values: DEDUCTION_ITEM_KINDS }),
  name: v.string({ max: 100 }),
  amountMinor: v.int({ min: 1, max: MAX_MINOR }),
  recurring: v.boolean(),
  enabled: v.boolean(),
};
export const DEDUCTION_KEYS = Object.keys(deductionFields);
const deductionCreate = {
  employeeId: v.int({ required: true, min: 1 }),
  ...deductionFields,
  kind: v.enum({ required: true, values: DEDUCTION_ITEM_KINDS }), name: v.string({ required: true, max: 100 }),
  amountMinor: v.int({ required: true, min: 1, max: MAX_MINOR }), recurring: v.boolean({ default: false }), enabled: v.boolean({ default: true }),
};
export const deductionListQuery = { employeeId: v.int({ required: true, min: 1 }) };
export function parseDeductionCreate(body) {
  const { value, errors } = parse(deductionCreate, body ?? {});
  return errors ? { errors } : { value };
}
export function parseDeductionUpdate(body) {
  const { value, errors } = parse(deductionFields, body ?? {});
  if (errors) return { errors };
  if (Object.keys(value).length === 0) return { errors: { _: `Send at least one of: ${DEDUCTION_KEYS.join(', ')}` } };
  return { value };
}
