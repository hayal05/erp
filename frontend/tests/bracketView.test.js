import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parseMoney, parseRate, moneyError, rateError } from '../src/api/money.js';
import { addBracketRow, bracketRows, bracketsChanged, bracketsValid, buildBrackets, previewTax, removeBracketRow, serverBracketErrors, setBracketField, validateBracketRows } from '../src/pages/bracketView.js';

const SAVED = [
  { id: 1, fromMinor: 0, toMinor: 60000, rate: 0, fixedDeductionMinor: 0 },
  { id: 2, fromMinor: 60000, toMinor: 150000, rate: 10, fixedDeductionMinor: 6000 },
  { id: 3, fromMinor: 150000, toMinor: null, rate: 15, fixedDeductionMinor: 13500 },
];

test('money: typed amounts become exact minor units and back', () => {
  assert.equal(parseMoney('2,500.50'), 250050);
  assert.equal(parseMoney('2500'), 250000);
  assert.equal(parseMoney(' 0.1 '), 10);
  assert.equal(parseMoney('0'), 0);
  assert.equal(formatMoney(250050), '2,500.50');
  assert.equal(formatMoney(5), '0.05');
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(-12345), '-123.45');
  for (const bad of ['', 'abc', '1.234', '1,00', '-5', '1e3', '99999999999999.99']) assert.throws(() => parseMoney(bad), bad);
  assert.equal(moneyError('12.5'), '');
  assert.match(moneyError('x'), /Enter an amount/);
  assert.throws(() => formatMoney(1.5));
});

test('rate: 0-100 with at most 4 decimals', () => {
  assert.equal(parseRate('15'), 15);
  assert.equal(parseRate('7.5'), 7.5);
  assert.equal(parseRate('0.0625'), 0.0625);
  assert.equal(parseRate('100'), 100);
  assert.match(rateError('100.1'), /At most 100/);
  assert.match(rateError('1.23456'), /4 decimals/);
  assert.ok(rateError('') && rateError('-1') && rateError('abc') && rateError('1,5'));
});

test('saved brackets show as editable text and build back to the same API items', () => {
  const rows = bracketRows(SAVED);
  assert.deepEqual(rows[1], { from: '600.00', to: '1,500.00', rate: '10', deduction: '60.00' });
  assert.equal(rows[2].to, '');
  assert.deepEqual(buildBrackets(rows).items, SAVED.map(({ id, ...r }) => r));
  assert.equal(bracketsChanged(rows, SAVED), false);
  assert.equal(bracketsChanged(setBracketField(rows, 1, 'rate', '10.0'), SAVED), false); // same value, different text
  assert.equal(bracketsChanged(setBracketField(rows, 1, 'rate', '11'), SAVED), true);
});

test('a valid table has no errors; every kind of bad table is explained', () => {
  const rows = bracketRows(SAVED);
  assert.deepEqual(validateBracketRows(rows), { rows: {}, problems: [] });
  assert.equal(bracketsValid(rows), true);
  assert.deepEqual(validateBracketRows([]).problems, ['Add at least one bracket']);
  assert.match(validateBracketRows(setBracketField(rows, 0, 'from', '10')).problems[0], /first bracket must start at 0/);
  assert.match(validateBracketRows(setBracketField(rows, 0, 'to', '700')).problems[0], /overlap/);
  assert.match(validateBracketRows(setBracketField(rows, 0, 'to', '500')).problems[0], /gap between brackets 1 and 2/);
  assert.match(validateBracketRows(setBracketField(rows, 2, 'to', '9,000')).problems[0], /last bracket must have no upper limit/);
  assert.match(validateBracketRows(setBracketField(rows, 1, 'to', '')).problems[0], /Bracket 2 has no upper limit/);
  assert.equal(bracketsValid(setBracketField(rows, 0, 'to', '500')), false);
});

test('row mistakes are reported per field, and table problems wait until every row is readable', () => {
  const rows = bracketRows(SAVED);
  const bad = setBracketField(setBracketField(rows, 1, 'rate', 'abc'), 2, 'deduction', '-1');
  const v = validateBracketRows(bad);
  assert.deepEqual(Object.keys(v.rows), ['1', '2']);
  assert.ok(v.rows[1].rate && v.rows[2].deduction);
  assert.deepEqual(v.problems, []);
  assert.ok(validateBracketRows(setBracketField(rows, 1, 'to', '600')).rows[1].to); // to must be above from
});

test('rows can be added (starting where the last ends), edited and removed', () => {
  const rows = bracketRows(SAVED.slice(0, 2));
  assert.equal(addBracketRow(rows)[2].from, '1,500.00');
  assert.equal(addBracketRow([])[0].from, '0');
  assert.equal(addBracketRow(bracketRows(SAVED))[3].from, '0'); // after an open-ended row there is nothing to continue from (the table is flagged instead)
  assert.equal(removeBracketRow(rows, 0).length, 1);
  assert.equal(rows.length, 2); // the original is untouched
});

test('server field errors map onto the same row display', () => {
  assert.deepEqual(serverBracketErrors({ 'items[2].rate': 'Too big', 'items[0].fixedDeductionMinor': 'Bad', items: 'Overlap' }),
    { rows: { 2: { rate: 'Too big' }, 0: { deduction: 'Bad' } }, problems: ['Overlap'] });
});

test('preview: tax = income x rate - fixed deduction, never below 0, from the matching bracket', () => {
  assert.equal(previewTax(SAVED, 250000).taxMinor, 24000); // 2,500 @15% - 135 = 240
  assert.equal(previewTax(SAVED, 250000).bracket.id, 3);
  assert.equal(previewTax(SAVED, 100000).taxMinor, 4000); // 1,000 @10% - 60 = 40
  assert.equal(previewTax(SAVED, 60000).bracket.id, 2);   // lower bound belongs to the upper bracket
  assert.equal(previewTax(SAVED, 59999).taxMinor, 0);
  assert.equal(previewTax([{ fromMinor: 0, toMinor: null, rate: 10, fixedDeductionMinor: 99999 }], 1000).taxMinor, 0);
  assert.equal(previewTax([{ fromMinor: 100, toMinor: null, rate: 10, fixedDeductionMinor: 0 }], 50), null);
});

test('previewFor: empty, bad text, matching bracket, no match', async () => {
  const { previewFor } = await import('../src/pages/bracketView.js');
  assert.deepEqual(previewFor('  ', SAVED), { kind: 'empty' });
  assert.equal(previewFor('abc', SAVED).kind, 'error');
  assert.deepEqual(previewFor('2,500', SAVED), { kind: 'tax', taxMinor: 24000, position: 3 }); // 250000 x 15% - 13500
  assert.deepEqual(previewFor('1,000', SAVED), { kind: 'tax', taxMinor: 4000, position: 2 }); // 100000 x 10% - 6000
  assert.deepEqual(previewFor('100', SAVED), { kind: 'tax', taxMinor: 0, position: 1 });
  assert.equal(previewFor('100', []).kind, 'none');
});
