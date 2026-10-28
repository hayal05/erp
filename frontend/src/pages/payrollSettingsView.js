// Pure helpers for the Pension, Other Taxes and Other Deductions tabs of the Payroll Settings page (task 4.9-2).
// Same pattern as bracketView.js: forms hold what the person types (strings), builders produce API bodies (minor units).
// The server validates again (backend services/payrollSchemas.js); these checks only give feedback before saving.
import { formatMoney, moneyError, parseMoney, parseRate, rateError, tryMoney } from '../api/money.js';

const numEq = (text, saved) => { try { return parseRate(text) === Number(saved); } catch { return false; } };
const nameError = (name) => (!name.trim() ? 'Enter a name' : name.trim().length > 100 ? 'At most 100 characters' : '');

// ---- Pension + bases (GET/PATCH /payroll-settings/calculation)
export const TAX_BASE_OPTIONS = [
  { value: 'basic', label: 'Basic salary only' },
  { value: 'basic_plus_taxable_allowance', label: 'Basic salary + taxable allowance' },
];
export const PENSION_BASE_OPTIONS = [
  { value: 'basic', label: 'Basic salary only' },
  { value: 'basic_plus_pensionable_allowance', label: 'Basic salary + pensionable allowance' },
];
export const calcForm = (s) => ({ employeePensionRate: String(s.employeePensionRate), companyPensionRate: String(s.companyPensionRate),
  taxBase: s.taxBase, pensionBase: s.pensionBase });

export function validateCalcForm(f) {
  const e = {};
  for (const k of ['employeePensionRate', 'companyPensionRate']) { const m = rateError(f[k]); if (m) e[k] = m; }
  if (!TAX_BASE_OPTIONS.some((o) => o.value === f.taxBase)) e.taxBase = 'Choose a tax base';
  if (!PENSION_BASE_OPTIONS.some((o) => o.value === f.pensionBase)) e.pensionBase = 'Choose a pension base';
  return e;
}
// PATCH body with only the keys that differ from the saved settings ({} = nothing to save). Call only when valid.
export function buildCalcPatch(f, saved) {
  const body = {};
  for (const k of ['employeePensionRate', 'companyPensionRate']) if (!numEq(f[k], saved[k])) body[k] = parseRate(f[k]);
  for (const k of ['taxBase', 'pensionBase']) if (f[k] !== saved[k]) body[k] = f[k];
  return body;
}
export const calcChanged = (f, saved) => Object.keys(validateCalcForm(f)).length > 0 || Object.keys(buildCalcPatch(f, saved)).length > 0;

// ---- Other taxes (GET/POST/PATCH/DELETE /payroll-settings/other-taxes). The base is always picked from the server's fixed list.
export const OTHER_TAX_BASE_LABELS = { gross: 'Gross salary', basic: 'Basic salary', taxable_income: 'Taxable income', pensionable: 'Pensionable salary' };
export const baseLabel = (b) => OTHER_TAX_BASE_LABELS[b] ?? b;
export const baseOptions = (bases = []) => bases.map((value) => ({ value, label: baseLabel(value) }));
export const EMPTY_OTHER_TAX = { name: '', rate: '', base: '', enabled: true };
export const otherTaxForm = (t) => ({ name: t.name, rate: String(t.rate), base: t.base, enabled: t.enabled });

export function validateOtherTax(f, bases = []) {
  const e = {};
  const n = nameError(f.name); if (n) e.name = n;
  const r = rateError(f.rate); if (r) e.rate = r;
  if (!f.base) e.base = 'Choose what the tax is calculated on';
  else if (!bases.includes(f.base)) e.base = 'Choose one of the listed bases';
  return e;
}
export const buildOtherTaxCreate = (f) => ({ name: f.name.trim(), rate: parseRate(f.rate), base: f.base, enabled: !!f.enabled });
export function buildOtherTaxPatch(f, t) {
  const body = {};
  if (f.name.trim() !== t.name) body.name = f.name.trim();
  if (!numEq(f.rate, t.rate)) body.rate = parseRate(f.rate);
  if (f.base !== t.base) body.base = f.base;
  if (!!f.enabled !== t.enabled) body.enabled = !!f.enabled;
  return body;
}
export const otherTaxLine = (t) => `${t.rate}% of ${baseLabel(t.base).toLowerCase()}${t.enabled ? '' : ' (paused)'}`;

// ---- Deduction items (/api/deductions, per employee). absence / unpaid_leave are never entered here (payroll computes them, 4.15).
export const DEDUCTION_KIND_OPTIONS = [
  { value: 'advance', label: 'Salary advance' }, { value: 'loan', label: 'Loan repayment' },
  { value: 'penalty', label: 'Penalty' }, { value: 'other', label: 'Other' },
];
export const EMPTY_DEDUCTION = { kind: 'advance', name: '', amount: '', recurring: false, enabled: true };
export const deductionForm = (d) => ({ kind: d.kind, name: d.name, amount: formatMoney(d.amountMinor), recurring: d.recurring, enabled: d.enabled });

// A one-time item is "used" once a payroll took it (appliedPeriodId set); the server then refuses edits and deletes (409).
export const isConsumed = (d) => d.appliedPeriodId != null;
export const deductionStatus = (d) => (isConsumed(d) ? 'Used' : !d.enabled ? 'Paused' : d.recurring ? 'Every month' : 'Next payroll');

export function validateDeduction(f) {
  const e = {};
  if (!DEDUCTION_KIND_OPTIONS.some((o) => o.value === f.kind)) e.kind = 'Choose a type';
  const n = nameError(f.name); if (n) e.name = n;
  const a = moneyError(f.amount);
  if (a) e.amount = a; else if (tryMoney(f.amount) < 1) e.amount = 'Enter an amount above 0';
  return e;
}
export const buildDeductionCreate = (f, employeeId) => ({ employeeId, kind: f.kind, name: f.name.trim(),
  amountMinor: parseMoney(f.amount), recurring: !!f.recurring, enabled: !!f.enabled });
export function buildDeductionPatch(f, d) {
  const body = {};
  if (f.kind !== d.kind) body.kind = f.kind;
  if (f.name.trim() !== d.name) body.name = f.name.trim();
  if (parseMoney(f.amount) !== d.amountMinor) body.amountMinor = parseMoney(f.amount);
  if (!!f.recurring !== d.recurring) body.recurring = !!f.recurring;
  if (!!f.enabled !== d.enabled) body.enabled = !!f.enabled;
  return body;
}
export const deductionKindLabel = (kind) => DEDUCTION_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
// Badge tone for the status column: used = neutral (history), paused = warn, live = ok.
export const deductionTone = (d) => (isConsumed(d) ? 'neutral' : !d.enabled ? 'warn' : 'ok');
// Employee picker label: "EMP-001 · Abebe Kebede" (code first so same-named people can be told apart).
export const employeeLabel = (e) => (e.employeeCode ? `${e.employeeCode} · ${e.fullName}` : e.fullName);
// ?employee= from the URL -> a positive integer id, or '' (anything else is ignored, never sent to the server).
export const employeeFromParam = (v) => (/^[1-9]\d{0,15}$/.test(String(v ?? '')) ? String(v) : '');
// Server field names -> form field names (amountMinor is typed as `amount`).
export const serverDeductionErrors = (fields = {}) => Object.fromEntries(Object.entries(fields).map(([k, m]) => [k === 'amountMinor' ? 'amount' : k, m]));

// ---- Page shell (task 4.9-3): the four tabs, in spec order. The active tab lives in the URL (?tab=pension) so a refresh or a
// shared link keeps it; anything unknown falls back to the first tab. `path` is the GET each tab loads (null = needs a choice first).
export const PAYROLL_TABS = [
  { key: 'income-tax', label: 'Income Tax', path: '/payroll-settings/brackets' },
  { key: 'pension', label: 'Pension', path: '/payroll-settings/calculation' },
  { key: 'other-taxes', label: 'Other Taxes', path: '/payroll-settings/other-taxes' },
  { key: 'other-deductions', label: 'Other Deductions', path: null },
];
export const PAYROLL_SETTINGS_PATH = '/hr/settings/payroll';
export const tabFromParam = (value) => (PAYROLL_TABS.find((t) => t.key === value) ?? PAYROLL_TABS[0]).key;
// Arrow keys move between tabs and wrap; Home/End jump. Returns the new key, or null for any other key.
export function tabForKey(current, key) {
  const i = Math.max(0, PAYROLL_TABS.findIndex((t) => t.key === current)), n = PAYROLL_TABS.length;
  const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[key];
  return to === undefined ? null : PAYROLL_TABS[to].key;
}
