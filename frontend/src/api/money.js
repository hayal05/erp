// Money in the browser (task 4.9-1). The API speaks whole MINOR units (cents/santim); people type '2,500.50'. Same rules as
// backend/src/services/money.js, kept as a separate copy because the frontend never imports backend code. Never uses a float.
export const MAX_MINOR = 9_999_999_999_999;

// '2,500.50' -> 250050. Throws Error(message) with text that can be shown under the field.
export function parseMoney(text, { digits = 2 } = {}) {
  const s = String(text ?? '').trim();
  if (/^-/.test(s)) throw new Error('The amount cannot be negative');
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error('Enter an amount such as 2500 or 2,500.50');
  const frac = m[2] ?? '';
  if (frac.length > digits) throw new Error(`At most ${digits} decimal places`);
  const big = BigInt(m[1].replaceAll(',', '') + frac.padEnd(digits, '0'));
  if (big > BigInt(MAX_MINOR)) throw new Error('The amount is too large');
  return Number(big);
}

// 250050 -> '2,500.50'.
export function formatMoney(minor, { digits = 2 } = {}) {
  if (!Number.isSafeInteger(minor)) throw new Error('Not a whole amount');
  const neg = minor < 0, abs = BigInt(neg ? -minor : minor), scale = 10n ** BigInt(digits);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${whole}${digits ? `.${(abs % scale).toString().padStart(digits, '0')}` : ''}`;
}

// Field helpers: never throw. `moneyError` is the message or '' when fine; `tryMoney` is the minor value or null.
export const moneyError = (text, opts) => { try { parseMoney(text, opts); return ''; } catch (e) { return e.message; } };
export const tryMoney = (text, opts) => { try { return parseMoney(text, opts); } catch { return null; } };

// Percentage field: '15', '7.5', '0.0625'; 0 to 100, at most 4 decimals. Returns the Number or throws Error(message).
export function parseRate(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) {
    throw new Error(/^\d{1,3}\.\d{5,}$/.test(s) ? 'At most 4 decimals' : 'Enter a percentage such as 15 or 7.5');
  }
  const n = Number(s);
  if (n > 100) throw new Error('At most 100');
  return n;
}
export const rateError = (text) => { try { parseRate(text); return ''; } catch (e) { return e.message; } };
