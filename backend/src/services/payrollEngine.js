// Payroll calculation engine (spec 13-17, task 4.3). ONE module, pure functions: no I/O, no clock, no database. The caller
// (routes/payroll.js, 4.11/4.12) loads the settings, brackets, other taxes, salary profile and deduction items, converts
// pg's bigint/numeric strings to the shapes below, and stores what comes back. The backend is authoritative: the browser never
// sends a computed amount.
//
// Money is integer MINOR units (money.js). Every percentage line is computed with ONE percentOf (one rounding) and a rounded
// value is never rounded again. Nothing statutory is assumed: no brackets, taxes or rates exist unless HR entered them.
//
//   gross          = basic + allowance
//   taxable income = basic                         (settings.taxBase 'basic')
//                  = basic + taxable allowance     (settings.taxBase 'basic_plus_taxable_allowance')
//   income tax     = MAX(0, taxable x rate/100 - fixed deduction)   of the bracket with from <= taxable < to
//   pensionable    = basic | basic + pensionable allowance, or 0 when the employee's pension does not apply
//   other taxes    = sum of base x rate/100 over enabled other taxes (base: gross | basic | taxable_income | pensionable)
//   net            = gross - income tax - other taxes - EMPLOYEE pension - other deductions   (company pension never reduces net)
//   employer cost  = gross + EMPLOYER pension
import { DEFAULT_ROUNDING, ROUNDING_MODES, MAX_MINOR, assertMinor, percentOf, rateToScaled, sumMinor } from './money.js';

export const TAX_BASES = Object.freeze(['basic', 'basic_plus_taxable_allowance']);
export const PENSION_BASES = Object.freeze(['basic', 'basic_plus_pensionable_allowance']);
export const OTHER_TAX_BASES = Object.freeze(['gross', 'basic', 'taxable_income', 'pensionable']);
export const DEDUCTION_KINDS = Object.freeze(['advance', 'loan', 'penalty', 'other', 'absence', 'unpaid_leave']);

// Raised for anything HR can fix (missing bracket, bad setting). `code` lets the API answer 422 with a stable reason.
export class PayrollError extends Error {
  constructor(code, message) { super(message); this.name = 'PayrollError'; this.code = code; }
}
const fail = (code, message) => { throw new PayrollError(code, message); };

const minor = (value, what) => {
  try { return assertMinor(value, what); } catch { return fail('invalid_input', `${what} must be a whole number of minor units`); }
};
const checkRate = (rate, what) => {
  try { rateToScaled(rate); } catch (e) { fail('invalid_input', `${what}: ${e.message}`); }
  return rate;
};
const oneOf = (value, list, what) => (list.includes(value) ? value : fail('invalid_input', `${what} must be one of: ${list.join(', ')}`));

// ------------------------------------------------------------------------------------------------------ tax brackets
// Problems that make the table unusable, as human-readable strings (empty = valid). A bracket covers from <= income < to;
// `toMinor` null = no upper limit. The table must start at 0, leave no gap, not overlap and end with an open-ended bracket,
// otherwise some income would have no matching bracket (spec 13: "validate gaps/overlaps/no-match").
export function validateBrackets(brackets) {
  if (!Array.isArray(brackets) || brackets.length === 0) return ['No income tax brackets are defined'];
  const problems = [];
  const sorted = [...brackets].sort((a, b) => a.fromMinor - b.fromMinor);
  sorted.forEach((b, i) => {
    const label = `Bracket ${i + 1}`;
    if (!Number.isSafeInteger(b.fromMinor) || b.fromMinor < 0) problems.push(`${label}: "from" must be a whole amount of 0 or more`);
    if (b.toMinor !== null && b.toMinor !== undefined && (!Number.isSafeInteger(b.toMinor) || b.toMinor <= b.fromMinor)) problems.push(`${label}: "to" must be above "from"`);
    if (!Number.isSafeInteger(b.fixedDeductionMinor ?? 0) || (b.fixedDeductionMinor ?? 0) < 0) problems.push(`${label}: the fixed deduction cannot be negative`);
    try { rateToScaled(b.rate); } catch { problems.push(`${label}: the rate must be between 0 and 100 with at most 4 decimals`); }
  });
  if (problems.length) return problems;
  if (sorted[0].fromMinor !== 0) problems.push('The first bracket must start at 0, otherwise low incomes match no bracket');
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i], next = sorted[i + 1];
    if (cur.toMinor === null || cur.toMinor === undefined) problems.push(`Bracket ${i + 1} has no upper limit but another bracket starts above it`);
    else if (cur.toMinor > next.fromMinor) problems.push(`Brackets ${i + 1} and ${i + 2} overlap`);
    else if (cur.toMinor < next.fromMinor) problems.push(`There is a gap between brackets ${i + 1} and ${i + 2}`);
  }
  const last = sorted[sorted.length - 1];
  if (last.toMinor !== null && last.toMinor !== undefined) problems.push('The last bracket must have no upper limit, otherwise high incomes match no bracket');
  return problems;
}

// The bracket for a taxable income. The table is validated first, so "no match" cannot be silently treated as zero tax.
export function findBracket(brackets, taxableMinor) {
  minor(taxableMinor, 'Taxable income');
  const problems = validateBrackets(brackets);
  if (problems.length) fail('invalid_brackets', `Income tax brackets are invalid: ${problems.join('; ')}`);
  const hit = brackets.find((b) => b.fromMinor <= taxableMinor && (b.toMinor === null || b.toMinor === undefined || taxableMinor < b.toMinor));
  return hit ?? fail('no_bracket', 'No income tax bracket matches this taxable income');
}

// ------------------------------------------------------------------------------------------------------- the engine
// settings: { taxBase, pensionBase, employeePensionRate, companyPensionRate, roundingMode }
// brackets: [{ fromMinor, toMinor|null, rate, fixedDeductionMinor }]
// otherTaxes: [{ id, name, rate, base, enabled }]           (disabled ones are ignored)
// profile: { basicMinor, allowanceMinor, allowanceTaxable, allowancePensionable, pensionApplies }
// deductions: [{ kind, label, amountMinor, sourceId }]       flat amounts already chosen for this period (4.8 items, and the
//                                                             absence / unpaid-leave amounts of 4.15, computed once by the caller)
// Returns every amount of a payroll entry plus the item breakdown, in the shape of payroll_entries / payroll_entry_items.
export function computeEntry({ settings, brackets, otherTaxes = [], profile, deductions = [] }) {
  if (!settings || !profile) fail('invalid_input', 'Settings and a salary profile are required');
  const mode = settings.roundingMode ?? DEFAULT_ROUNDING;
  oneOf(mode, ROUNDING_MODES, 'The rounding mode');
  oneOf(settings.taxBase, TAX_BASES, 'The tax base');
  oneOf(settings.pensionBase, PENSION_BASES, 'The pension base');
  const employeeRate = checkRate(settings.employeePensionRate, 'Employee pension rate');
  const companyRate = checkRate(settings.companyPensionRate, 'Company pension rate');

  const basic = minor(profile.basicMinor, 'Basic salary');
  const allowance = minor(profile.allowanceMinor, 'Allowance');
  if (basic < 0 || allowance < 0) fail('invalid_input', 'Salary amounts cannot be negative');
  const gross = sumMinor([basic, allowance]);

  const taxable = settings.taxBase === 'basic' ? basic : basic + (profile.allowanceTaxable ? allowance : 0);
  const pensionable = !profile.pensionApplies ? 0
    : settings.pensionBase === 'basic' ? basic : basic + (profile.allowancePensionable ? allowance : 0);

  const bracket = findBracket(brackets, taxable);
  const incomeTax = Math.max(0, percentOf(taxable, bracket.rate, mode) - (bracket.fixedDeductionMinor ?? 0));

  const bases = { gross, basic, taxable_income: taxable, pensionable };
  const items = [];
  for (const t of otherTaxes) {
    if (!t.enabled) continue;
    oneOf(t.base, OTHER_TAX_BASES, `The base of "${t.name}"`);
    checkRate(t.rate, `The rate of "${t.name}"`);
    const base = bases[t.base];
    items.push({ kind: 'other_tax', label: t.name, rate: t.rate, baseMinor: base, amountMinor: percentOf(base, t.rate, mode), sourceId: t.id ?? null });
  }
  const otherTax = sumMinor(items.map((i) => i.amountMinor));

  const flat = [];
  for (const d of deductions) {
    oneOf(d.kind, DEDUCTION_KINDS, 'The deduction kind');
    const amount = minor(d.amountMinor, `The amount of "${d.label}"`);
    if (amount <= 0 || amount > MAX_MINOR) fail('invalid_input', `The amount of "${d.label}" must be positive`);
    flat.push({ kind: d.kind, label: d.label, rate: null, baseMinor: null, amountMinor: amount, sourceId: d.sourceId ?? null });
  }
  const otherDeductions = sumMinor(flat.map((i) => i.amountMinor));

  const employeePension = percentOf(pensionable, employeeRate, mode);
  const employerPension = percentOf(pensionable, companyRate, mode);
  const net = gross - incomeTax - otherTax - employeePension - otherDeductions; // may be negative: HR must see it, not hide it
  return {
    basicMinor: basic, allowanceMinor: allowance, grossMinor: gross,
    taxableIncomeMinor: taxable, incomeTaxRate: bracket.rate, incomeTaxFixedDeductionMinor: bracket.fixedDeductionMinor ?? 0, incomeTaxMinor: incomeTax,
    otherTaxMinor: otherTax,
    pensionableMinor: pensionable,
    employeePensionRate: employeeRate, employeePensionMinor: employeePension,
    employerPensionRate: companyRate, employerPensionMinor: employerPension,
    otherDeductionsMinor: otherDeductions,
    netMinor: net,
    employerCostMinor: gross + employerPension,
    items: [...items, ...flat],
  };
}
