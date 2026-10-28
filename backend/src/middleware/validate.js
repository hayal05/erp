import { HttpError } from './error.js';

// Declarative request validation. Usage:
//   router.post('/x', validate({ name: v.string({ required: true, max: 100 }), age: v.int({ min: 0 }) }), handler)
// On success req[source] is replaced by a cleaned copy: only schema keys, trimmed, typed.
// Unknown keys are dropped (no mass assignment). On failure: 400 `validation` with
// details.fields = { fieldName: 'message' }.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

const range = (n, r) => (r.min != null && n < r.min ? `Must be at least ${r.min}`
  : r.max != null && n > r.max ? `Must be at most ${r.max}` : null);

// Each checker returns { value } or { error }. `coerce` allows numeric/boolean strings (query strings).
const checkers = {
  string(v, r) {
    if (typeof v !== 'string') return { error: 'Must be text' };
    const s = r.trim === false ? v : v.trim();
    if (r.min != null && s.length < r.min) return { error: `Must be at least ${r.min} characters` };
    if (s.length > (r.max ?? 255)) return { error: `Must be at most ${r.max ?? 255} characters` };
    if (r.pattern && !r.pattern.test(s)) return { error: r.patternMessage ?? 'Invalid format' };
    return { value: s };
  },
  email(v, r) {
    const out = checkers.string(v, { ...r, max: r.max ?? 254 });
    if (out.error) return out;
    return EMAIL.test(out.value) ? { value: out.value.toLowerCase() } : { error: 'Must be a valid email address' };
  },
  number(v, r, coerce) {
    const n = typeof v === 'string' && coerce && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'Must be a number' };
    const e = range(n, r);
    return e ? { error: e } : { value: n };
  },
  int(v, r, coerce) {
    const n = typeof v === 'string' && coerce && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
    if (!Number.isSafeInteger(n)) return { error: 'Must be a whole number' };
    const e = range(n, r);
    return e ? { error: e } : { value: n };
  },
  boolean(v, r, coerce) {
    if (typeof v === 'boolean') return { value: v };
    if (coerce && (v === 'true' || v === 'false')) return { value: v === 'true' };
    return { error: 'Must be true or false' };
  },
  // List of whole numbers (e.g. ISO weekdays). Duplicates are rejected; the result is sorted.
  intList(v, r) {
    if (!Array.isArray(v)) return { error: 'Must be a list' };
    if (r.minItems != null && v.length < r.minItems) return { error: `Pick at least ${r.minItems}` };
    if (v.length > (r.maxItems ?? 50)) return { error: `Pick at most ${r.maxItems ?? 50}` };
    for (const n of v) {
      if (!Number.isSafeInteger(n)) return { error: 'Must contain whole numbers only' };
      const e = range(n, r);
      if (e) return { error: e };
    }
    if (new Set(v).size !== v.length) return { error: 'Must not contain duplicates' };
    return { value: [...v].sort((a, b) => a - b) };
  },
  enum(v, r) {
    return r.values.includes(v) ? { value: v } : { error: `Must be one of: ${r.values.join(', ')}` };
  },
  date: (v) => (typeof v === 'string' && isRealDate(v) ? { value: v } : { error: 'Must be a date (YYYY-MM-DD)' }),
  time: (v) => (typeof v === 'string' && TIME.test(v) ? { value: v } : { error: 'Must be a time (HH:MM)' }),
};

// Rule builders: v.string({ required, nullable, default, min, max, pattern, patternMessage, trim })
export const v = Object.fromEntries(Object.keys(checkers).map((type) => [type, (opts = {}) => ({ type, ...opts })]));

// Pure function, reusable outside Express. Returns { value, errors } (errors is null when valid).
export function parse(schema, data, { coerce = false } = {}) {
  if (!isObj(data)) return { value: null, errors: { _: 'Expected an object' } };
  const value = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    let raw = Object.hasOwn(data, key) ? data[key] : undefined;
    if (typeof raw === 'string' && rule.type !== 'string' && rule.type !== 'email') raw = raw.trim();
    const missing = raw === undefined || raw === '' || (typeof raw === 'string' && rule.trim !== false && raw.trim() === '');
    if (raw === null && rule.nullable) { value[key] = null; continue; }
    if (missing || raw === null) {
      if (rule.required) errors[key] = 'Required';
      else if (rule.default !== undefined) value[key] = rule.default;
      continue;
    }
    const out = checkers[rule.type](raw, rule, coerce);
    if (out.error) errors[key] = out.error;
    else value[key] = out.value;
  }
  return Object.keys(errors).length ? { value: null, errors } : { value, errors: null };
}

export const validate = (schema, source = 'body') => (req, res, next) => {
  // A missing body (no JSON sent) counts as an empty object so optional-only schemas still work.
  const input = source === 'body' && req.body === undefined ? {} : req[source];
  const { value, errors } = parse(schema, input, { coerce: source !== 'body' });
  if (errors) return next(new HttpError(400, 'Invalid request', 'validation', { fields: errors }));
  req[source] = value;
  next();
};
