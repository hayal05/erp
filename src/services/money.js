// Money utilities (spec 17, task 4.2). Money is ALWAYS an integer number of minor units (1 ETB = 100); there is no floating
// point anywhere in payroll arithmetic. Rates are percentages with at most 4 decimals (the database's numeric(7,4)).
// Products are computed with BigInt (amount x rate can exceed 2^53), then rounded ONCE, with the configured mode, and
// handed back as a plain safe-integer Number so the rest of the code (and JSON) stays simple.
// Pure module: no imports, no I/O.

export const ROUNDING_MODES = Object.freeze(['half_up', 'half_even', 'down', 'up']);
export const DEFAULT_ROUNDING = 'half_up';
export const MAX_MINOR = 9_999_999_999_999; // same ceiling as the database CHECKs (about 100 billion major units)
const RATE_DECIMALS = 4;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

export const isMinor = (n) => Number.isSafeInteger(n);
export function assertMinor(n, what = 'amount') {
  if (!isMinor(n)) throw new Error(`${what} must be a whole number of minor units`);
  return n;
}

// Exact integer division with the configured rounding. `down` = toward zero, `up` = away from zero,
// `half_up` = nearest, halves away from zero, `half_even` = nearest, halves to the even neighbour (banker's rounding).
export function divRound(numerator, denominator, mode = DEFAULT_ROUNDING) {
  if (!ROUNDING_MODES.includes(mode)) throw new Error(`Unknown rounding mode "${mode}"`);
  const n = BigInt(numerator), d = BigInt(denominator);
  if (d <= 0n) throw new Error('The divisor must be positive');
  const neg = n < 0n, abs = neg ? -n : n;
  let q = abs / d;
  const r = abs % d;
  if (r !== 0n) {
    const twice = r * 2n;
    if (mode === 'up') q += 1n;
    else if (mode === 'half_up' && twice >= d) q += 1n;
    else if (mode === 'half_even' && (twice > d || (twice === d && q % 2n === 1n))) q += 1n;
  }
  return neg ? -q : q;
}

// '15', '15.5', 15, '15.0000' -> scaled BigInt (x 10^4). More than 4 decimals, exponents, NaN and Infinity are refused,
// so a rate can never silently lose digits.
export function rateToScaled(rate) {
  const text = typeof rate === 'number' ? (Number.isFinite(rate) ? String(rate) : '') : String(rate ?? '').trim();
  const m = /^(\d{1,3})(?:\.(\d{1,4})0*)?$/.exec(text);
  if (!m) throw new Error('A rate must be a plain percentage with at most 4 decimals');
  const scaled = BigInt(m[1]) * RATE_SCALE + BigInt((m[2] ?? '').padEnd(RATE_DECIMALS, '0'));
  if (scaled > 100n * RATE_SCALE) throw new Error('A rate cannot be above 100');
  return scaled;
}

const toNumber = (big, what = 'result') => {
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} is too large`);
  return Number(big);
};

// amount x rate% rounded once: percentOf(250000, 15) = 37500 (2,500.00 -> 375.00).
export function percentOf(amountMinor, rate, mode = DEFAULT_ROUNDING) {
  assertMinor(amountMinor);
  return toNumber(divRound(BigInt(amountMinor) * rateToScaled(rate), 100n * RATE_SCALE, mode));
}

// Exact sum of whole minor units; fails loudly instead of drifting past the safe range.
export function sumMinor(values) {
  let total = 0n;
  for (const v of values) total += BigInt(assertMinor(v));
  return toNumber(total, 'sum');
}

// '2,500.50' -> 250050. Strict: digits with optional thousands commas and at most `digits` decimals; no exponent, no sign
// unless `allowNegative`. Never goes through a float, so '0.1' + '0.2' cannot become 30.000000000000004.
export function parseMoney(text, { digits = 2, allowNegative = false } = {}) {
  const s = String(text ?? '').trim();
  const m = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error('Enter an amount such as 2500 or 2,500.50');
  if (m[1] && !allowNegative) throw new Error('The amount cannot be negative');
  const frac = m[3] ?? '';
  if (frac.length > digits) throw new Error(`At most ${digits} decimal places`);
  const big = BigInt(m[2].replaceAll(',', '') + frac.padEnd(digits, '0'));
  const value = toNumber(m[1] ? -big : big, 'amount');
  if (Math.abs(value) > MAX_MINOR) throw new Error('The amount is too large');
  return value;
}

// 250050 -> '2,500.50'. Always shows `digits` decimals; negatives get a leading minus.
export function formatMoney(minor, { digits = 2 } = {}) {
  assertMinor(minor);
  const neg = minor < 0, abs = BigInt(neg ? -minor : minor);
  const scale = 10n ** BigInt(digits);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = digits ? `.${(abs % scale).toString().padStart(digits, '0')}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}
