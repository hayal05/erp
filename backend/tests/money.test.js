import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUNDING_MODES, MAX_MINOR, divRound, rateToScaled, percentOf, sumMinor, parseMoney, formatMoney, assertMinor } from '../src/services/money.js';

test('sums of whole minor units are exact where floats drift', () => {
  assert.notEqual(0.1 + 0.2, 0.3); // the problem this module exists to avoid
  assert.equal(sumMinor([parseMoney('0.10'), parseMoney('0.20')]), parseMoney('0.30'));
  assert.equal(sumMinor(Array(1000).fill(parseMoney('0.10'))), 10000); // 1000 x 0.10 = 100.00 exactly
  assert.equal(sumMinor([]), 0);
  assert.throws(() => sumMinor([1, 2.5]), /whole number/);
  assert.throws(() => sumMinor([Number.MAX_SAFE_INTEGER, 1]), /whole number|too large/);
});

test('the spec example: 2,500.00 at 15% with a 150.00 fixed deduction is 225.00', () => {
  const tax = Math.max(0, percentOf(parseMoney('2500'), 15) - parseMoney('150'));
  assert.equal(tax, parseMoney('225'));
  assert.equal(formatMoney(tax), '225.00');
});

test('rounding modes on exact halves (1 and 3 minor units at 50%, and a negative)', () => {
  const at = (amount, mode) => percentOf(amount, 50, mode);
  assert.deepEqual(ROUNDING_MODES.map((m) => at(1, m)), [1, 0, 0, 1]); // half_up, half_even, down, up for 0.5
  assert.deepEqual(ROUNDING_MODES.map((m) => at(3, m)), [2, 2, 1, 2]); // 1.5
  assert.deepEqual(ROUNDING_MODES.map((m) => at(5, m)), [3, 2, 2, 3]); // 2.5: half_even goes to the even 2
  assert.deepEqual(ROUNDING_MODES.map((m) => Number(divRound(-1, 2, m))), [-1, 0, 0, -1]); // symmetric around zero
  assert.deepEqual(ROUNDING_MODES.map((m) => Number(divRound(-5, 2, m))), [-3, -2, -2, -3]);
});

test('rounding modes below, above and exactly at a half; exact results are never changed', () => {
  assert.deepEqual(ROUNDING_MODES.map((m) => percentOf(1, 49.9999, m)), [0, 0, 0, 1]); // 0.499999
  assert.deepEqual(ROUNDING_MODES.map((m) => percentOf(1, 50.0001, m)), [1, 1, 0, 1]); // 0.500001
  for (const m of ROUNDING_MODES) {
    assert.equal(percentOf(250000, 15, m), 37500);
    assert.equal(percentOf(123456, 100, m), 123456);
    assert.equal(percentOf(123456, 0, m), 0);
  }
  assert.equal(percentOf(333, 10), 33); // 33.3
  assert.equal(percentOf(335, 10), 34); // 33.5 -> half_up
  assert.equal(percentOf(335, 10, 'half_even'), 34); // 33.5 -> 34 (even)
  assert.equal(percentOf(325, 10, 'half_even'), 32); // 32.5 -> 32 (even)
  assert.throws(() => percentOf(100, 10, 'banana'), /Unknown rounding mode/);
});

test('large amounts do not lose precision (the product exceeds 2^53)', () => {
  assert.equal(percentOf(MAX_MINOR, 100), MAX_MINOR);
  assert.equal(percentOf(MAX_MINOR, 99.9999), 9_999_989_999_999); // 9,999,999,999,999 x 0.999999, exact in BigInt
  assert.equal(percentOf(MAX_MINOR, 0.0001), 10_000_000); // 9,999,999.999999 rounds up to 10,000,000
  assert.equal(percentOf(MAX_MINOR, 0.0001, 'down'), 9_999_999);
});

test('rates: plain percentages with at most 4 decimals, 0-100', () => {
  assert.equal(rateToScaled('15'), 150000n);
  assert.equal(rateToScaled('15.0000'), 150000n);
  assert.equal(rateToScaled(5.5), 55000n);
  assert.equal(rateToScaled('100'), 1000000n);
  for (const bad of ['100.0001', '101', '-1', '1e2', '15.12345', '', 'abc', NaN, Infinity, null, undefined]) assert.throws(() => rateToScaled(bad), /rate/i, String(bad));
});

test('parseMoney / formatMoney are strict and round-trip', () => {
  assert.equal(parseMoney('2500'), 250000);
  assert.equal(parseMoney('2,500.5'), 250050);
  assert.equal(parseMoney(' 0.07 '), 7);
  assert.equal(parseMoney('-3.50', { allowNegative: true }), -350);
  assert.equal(parseMoney('1.5', { digits: 1 }), 15);
  for (const bad of ['', 'abc', '1.234', '1,00', '1e3', '-5', '1.', '.5', '12,34', '99999999999999.99']) assert.throws(() => parseMoney(bad), Error, bad);
  assert.equal(formatMoney(250050), '2,500.50');
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(5), '0.05');
  assert.equal(formatMoney(-123456789), '-1,234,567.89');
  assert.equal(formatMoney(MAX_MINOR), '99,999,999,999.99');
  for (const v of [0, 1, 99, 100, 250050, 123456789, MAX_MINOR]) assert.equal(parseMoney(formatMoney(v)), v);
  assert.throws(() => formatMoney(1.5), /whole number/);
  assert.throws(() => assertMinor('5'), /whole number/);
});
