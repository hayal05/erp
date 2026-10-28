import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, formatDay, isWorkingDay, workingDaysBetween, workingDaysForEmployee, MAX_RANGE_DAYS } from '../src/services/workdays.js';

const MON_FRI = [1, 2, 3, 4, 5];
const count = (start, end, workDays = MON_FRI, holidays = []) => workingDaysBetween({ start, end, workDays, holidays }).days;

test('weekends are excluded: Mon 2026-10-26 to Sun 2026-11-01 is 5 days', () => {
  const r = workingDaysBetween({ start: '2026-10-26', end: '2026-11-01', workDays: MON_FRI });
  assert.equal(r.days, 5);
  assert.deepEqual(r.dates, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
});

test('a single working day is 1, a single weekend day is 0', () => {
  assert.equal(count('2026-10-28', '2026-10-28'), 1);
  assert.equal(count('2026-10-31', '2026-10-31'), 0); // Saturday
  assert.equal(count('2026-10-31', '2026-11-01'), 0);
});

test('holidays on working days are excluded; a holiday on a weekend is not subtracted twice', () => {
  assert.equal(count('2026-10-26', '2026-10-30', MON_FRI, ['2026-10-28']), 4);
  assert.equal(count('2026-10-26', '2026-10-30', MON_FRI, ['2026-10-28', '2026-10-28']), 4); // duplicates
  assert.equal(count('2026-10-26', '2026-11-01', MON_FRI, ['2026-10-31']), 5); // Saturday holiday
  assert.equal(count('2026-10-26', '2026-10-30', MON_FRI, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']), 0);
});

test('holidays outside the range are ignored', () => {
  assert.equal(count('2026-10-26', '2026-10-30', MON_FRI, ['2026-10-25', '2026-11-02', '2025-10-28']), 5);
});

test('the employee\'s own schedule decides: a Sunday-Thursday shift and a six-day shift', () => {
  assert.equal(count('2026-10-26', '2026-11-01', [7, 1, 2, 3, 4]), 5); // Fri/Sat off
  assert.equal(count('2026-10-26', '2026-11-01', [1, 2, 3, 4, 5, 6]), 6);
  assert.equal(count('2026-10-26', '2026-11-01', [1, 2, 3, 4, 5, 6, 7]), 7);
  assert.equal(count('2026-10-26', '2026-11-01', []), 0);
  assert.equal(count('2026-10-26', '2026-11-01', ['1', '3']), 2); // numeric strings (as drivers may return them)
});

test('ranges crossing a month, a leap day and a year end are counted by calendar', () => {
  assert.equal(count('2026-10-29', '2026-11-03'), 4); // Thu Fri Mon Tue
  assert.equal(count('2028-02-28', '2028-03-01'), 3); // 2028-02-29 is a Tuesday
  assert.equal(count('2027-02-26', '2027-03-01'), 2); // no leap day in 2027: Fri, Mon
  assert.equal(count('2026-12-28', '2027-01-04'), 6); // spans the year (the DB CHECK, not this module, forbids requests like this)
});

test('a full year has the expected number of weekdays (2026: 261)', () => {
  assert.equal(count('2026-01-01', '2026-12-31'), 261);
});

test('isWorkingDay combines weekday and holidays', () => {
  assert.equal(isWorkingDay('2026-10-28', MON_FRI), true);
  assert.equal(isWorkingDay('2026-10-28', MON_FRI, ['2026-10-28']), false);
  assert.equal(isWorkingDay('2026-10-31', MON_FRI), false);
});

test('bad input is rejected with a clear message, never silently rolled over', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '26-10-01', '2026/10/01', '', null, undefined, '2026-10-1']) {
    assert.throws(() => dayNumber(bad), /YYYY-MM-DD|real date/, String(bad));
  }
  assert.throws(() => workingDaysBetween({ start: '2026-10-30', end: '2026-10-26', workDays: MON_FRI }), /on or after/);
  assert.throws(() => workingDaysBetween({ start: '2026-01-01', end: '2027-01-02', workDays: MON_FRI }), new RegExp(String(MAX_RANGE_DAYS)));
  assert.throws(() => workingDaysBetween({ start: '2026-10-26', end: '2026-10-27', workDays: [0] }), /ISO weekdays/);
  assert.throws(() => workingDaysBetween({ start: '2026-10-26', end: '2026-10-27', workDays: [8] }), /ISO weekdays/);
  assert.throws(() => workingDaysBetween({ start: '2026-10-26', end: '2026-10-27', workDays: MON_FRI, holidays: ['nope'] }), /YYYY-MM-DD/);
});

test('day numbers round-trip', () => {
  assert.equal(formatDay(dayNumber('2026-10-28')), '2026-10-28');
  assert.equal(dayNumber('1970-01-02') - dayNumber('1970-01-01'), 1);
});

test('workingDaysForEmployee reads the shift and only the holidays in range (fake db)', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push([sql, params]);
    if (/FROM employees/.test(sql)) return { rows: [{ id: '7', work_days: [1, 2, 3, 4, 5] }] };
    return { rows: [{ d: '2026-10-28' }] };
  } };
  const r = await workingDaysForEmployee(db, { employeeId: 42, start: '2026-10-26', end: '2026-10-30' });
  assert.deepEqual([r.days, r.shiftId], [4, 7]);
  assert.deepEqual(calls[0][1], [42]);
  assert.deepEqual(calls[1][1], ['2026-10-26', '2026-10-30']); // bound parameters, range only
  await assert.rejects(workingDaysForEmployee({ query: async () => ({ rows: [] }) }, { employeeId: 1, start: '2026-10-26', end: '2026-10-27' }), /no shift/);
  await assert.rejects(workingDaysForEmployee(db, { employeeId: 1, start: 'x', end: '2026-10-27' }), /YYYY-MM-DD/);
});
