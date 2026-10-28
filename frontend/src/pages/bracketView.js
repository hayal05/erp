// Pure helpers for the Income Tax tab (task 4.9-1): the bracket table as the person edits it (strings) <-> the API (minor units).
// Tax = MAX(0, income x rate/100 - fixed deduction) on the bracket where from <= income < to (spec 13). The server validates again;
// the checks here only give feedback before saving.
import { formatMoney, moneyError, parseMoney, parseRate, rateError, tryMoney } from '../api/money.js';

export const MAX_BRACKETS = 30;
export const EMPTY_BRACKET = { from: '0', to: '', rate: '0', deduction: '0' };

// API item -> editable row. An open-ended bracket has an empty "to".
export const bracketRow = (b) => ({ from: formatMoney(b.fromMinor), to: b.toMinor === null ? '' : formatMoney(b.toMinor),
  rate: String(b.rate), deduction: formatMoney(b.fixedDeductionMinor) });
export const bracketRows = (items) => items.map(bracketRow);

// A new row starts where the last one ends (or at 0 for the first), so adding rows never creates a gap by itself.
export function addBracketRow(rows) {
  const last = rows[rows.length - 1];
  return [...rows, { ...EMPTY_BRACKET, from: last && last.to.trim() ? last.to.trim() : '0' }];
}
export const removeBracketRow = (rows, i) => rows.filter((_, k) => k !== i);
export const setBracketField = (rows, i, field, value) => rows.map((r, k) => (k === i ? { ...r, [field]: value } : r));

// -> { rows: { [index]: { from?, to?, rate?, deduction? } }, problems: [string] }. `problems` are about the table as a whole
// (gap, overlap, first bracket not 0, last bracket not open-ended) and only appear once every row is individually readable.
export function validateBracketRows(rows) {
  const out = { rows: {}, problems: [] };
  if (rows.length === 0) { out.problems.push('Add at least one bracket'); return out; }
  if (rows.length > MAX_BRACKETS) { out.problems.push(`At most ${MAX_BRACKETS} brackets`); return out; }
  const set = (i, f, msg) => { if (msg) (out.rows[i] ??= {})[f] = msg; };
  rows.forEach((r, i) => {
    set(i, 'from', moneyError(r.from));
    if (r.to.trim()) set(i, 'to', moneyError(r.to));
    set(i, 'rate', rateError(r.rate));
    set(i, 'deduction', moneyError(r.deduction));
  });
  if (Object.keys(out.rows).length) return out;
  const items = rows.map((r) => ({ from: tryMoney(r.from), to: r.to.trim() ? tryMoney(r.to) : null, i: 0 })).map((b, i) => ({ ...b, i }));
  items.forEach((b) => { if (b.to !== null && b.to <= b.from) set(b.i, 'to', 'Must be above "from"'); });
  if (Object.keys(out.rows).length) return out;
  const sorted = [...items].sort((a, b) => a.from - b.from);
  if (sorted[0].from !== 0) out.problems.push('The first bracket must start at 0, otherwise low incomes match no bracket');
  for (let k = 0; k < sorted.length - 1; k++) {
    const cur = sorted[k], next = sorted[k + 1], at = `${k + 1} and ${k + 2}`;
    if (cur.to === null) out.problems.push(`Bracket ${k + 1} has no upper limit but another bracket starts above it`);
    else if (cur.to > next.from) out.problems.push(`Brackets ${at} overlap`);
    else if (cur.to < next.from) out.problems.push(`There is a gap between brackets ${at}`);
  }
  if (sorted[sorted.length - 1].to !== null) out.problems.push('The last bracket must have no upper limit, otherwise high incomes match no bracket');
  return out;
}
export const bracketsValid = (rows) => { const v = validateBracketRows(rows); return !Object.keys(v.rows).length && !v.problems.length; };

// Rows -> the PUT /brackets body. Call only when valid. Sorted by "from", as the server returns them.
export const buildBrackets = (rows) => ({ items: rows.map((r) => ({ fromMinor: parseMoney(r.from), toMinor: r.to.trim() ? parseMoney(r.to) : null,
  rate: parseRate(r.rate), fixedDeductionMinor: parseMoney(r.deduction) })).sort((a, b) => a.fromMinor - b.fromMinor) });

// Has anything changed compared with the saved table? (Compares what would be sent, so '2500' vs '2,500.00' is not a change.)
export function bracketsChanged(rows, saved) {
  if (!bracketsValid(rows)) return true;
  return JSON.stringify(buildBrackets(rows).items) !== JSON.stringify(saved.map(({ fromMinor, toMinor, rate, fixedDeductionMinor }) => ({ fromMinor, toMinor, rate, fixedDeductionMinor })));
}

// A server 400 names fields like 'items[2].rate' or 'items' -> { rows: {2: {rate: msg}}, problems: [msg] } for the same display.
export function serverBracketErrors(fields = {}) {
  const out = { rows: {}, problems: [] };
  for (const [k, msg] of Object.entries(fields)) {
    const m = /^items\[(\d+)\]\.(fromMinor|toMinor|rate|fixedDeductionMinor)$/.exec(k);
    if (!m) { out.problems.push(msg); continue; }
    const f = { fromMinor: 'from', toMinor: 'to', rate: 'rate', fixedDeductionMinor: 'deduction' }[m[2]];
    (out.rows[Number(m[1])] ??= {})[f] = msg;
  }
  return out;
}

// Worked example for the page: tax on an income in minor units with the saved table (display only, the server calculates payroll).
export function previewTax(items, incomeMinor) {
  const b = items.find((x) => x.fromMinor <= incomeMinor && (x.toMinor === null || incomeMinor < x.toMinor));
  if (!b) return null;
  const [num, den] = [BigInt(incomeMinor) * BigInt(Math.round(b.rate * 10000)), 1000000n];
  const raw = (num + den / 2n) / den - BigInt(b.fixedDeductionMinor); // half-up, display only
  return { bracket: b, taxMinor: Number(raw < 0n ? 0n : raw) };
}

// The preview box on the Income Tax tab: typed income + the SAVED table -> what to show. Never throws.
//   { kind: 'empty' } nothing typed | { kind: 'error', message } | { kind: 'none' } no bracket matches | { kind: 'tax', taxMinor, position }
export function previewFor(text, items) {
  if (!String(text ?? '').trim()) return { kind: 'empty' };
  const income = tryMoney(text);
  if (income === null) return { kind: 'error', message: moneyError(text) };
  const r = previewTax(items, income);
  if (!r) return { kind: 'none' };
  return { kind: 'tax', taxMinor: r.taxMinor, position: items.indexOf(r.bracket) + 1 };
}
