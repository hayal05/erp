import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_SHIFT, buildHoliday, buildShift, formatWorkDays, holidayChanged, saveErrorView, shiftChanged, shiftRow, toggleDay, validateHoliday, validateShift } from '../src/pages/settingsView.js';

const SHIFT = { id: 1, name: 'Day', startTime: '09:00', endTime: '17:00', graceMinutes: 10, workDays: [1, 2, 3, 4, 5], employeeCount: 12 };
const form = (o = {}) => ({ ...EMPTY_SHIFT, name: 'Day', ...o });

test('work days read naturally: runs of three or more are shortened', () => {
  assert.equal(formatWorkDays([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(formatWorkDays([1, 2, 3, 4, 5, 6]), 'Mon–Sat');
  assert.equal(formatWorkDays([1, 2, 3, 6]), 'Mon–Wed, Sat');
  assert.equal(formatWorkDays([1, 2]), 'Mon, Tue');
  assert.equal(formatWorkDays([2, 4, 7]), 'Tue, Thu, Sun');
  assert.equal(formatWorkDays([7, 1, 1, 3]), 'Mon, Wed, Sun'); // unordered and duplicated input is tolerated
  assert.equal(formatWorkDays([]), 'No work days');
  assert.equal(formatWorkDays(undefined), 'No work days');
});

test('toggling a weekday adds or removes it and keeps the list sorted', () => {
  assert.deepEqual(toggleDay([1, 2, 3], 6), [1, 2, 3, 6]);
  assert.deepEqual(toggleDay([1, 2, 3, 6], 2), [1, 3, 6]);
  assert.deepEqual(toggleDay([3], 1), [1, 3]);
});

test('holiday: a date and a name are required; the body is trimmed; unchanged forms are detected', () => {
  assert.deepEqual(validateHoliday({ date: '', name: '' }), { date: 'Choose a date', name: 'Give the holiday a name' });
  assert.ok(validateHoliday({ date: '1999-12-31', name: 'x' }).date);
  assert.ok(validateHoliday({ date: '2026-05-01', name: 'x'.repeat(101) }).name);
  assert.deepEqual(validateHoliday({ date: '2026-05-01', name: ' Labour Day ' }), {});
  assert.deepEqual(buildHoliday({ date: '2026-05-01', name: ' Labour Day ' }), { date: '2026-05-01', name: 'Labour Day' });
  assert.equal(holidayChanged({ date: '2026-05-01', name: 'Labour Day ' }, { date: '2026-05-01', name: 'Labour Day' }), false);
  assert.equal(holidayChanged({ date: '2026-05-02', name: 'Labour Day' }, { date: '2026-05-01', name: 'Labour Day' }), true);
});

test('schedule: name, times, grace and at least one work day are required; the end must be after the start', () => {
  assert.deepEqual(validateShift(form()), {});
  assert.ok(validateShift(form({ name: ' ' })).name);
  assert.ok(validateShift(form({ startTime: '' })).startTime);
  assert.ok(validateShift(form({ endTime: '' })).endTime);
  assert.ok(validateShift(form({ startTime: '17:00', endTime: '09:00' })).endTime);
  assert.ok(validateShift(form({ startTime: '09:00', endTime: '09:00' })).endTime);
  assert.ok(validateShift(form({ graceMinutes: '-1' })).graceMinutes);
  assert.ok(validateShift(form({ graceMinutes: '1.5' })).graceMinutes);
  assert.ok(validateShift(form({ graceMinutes: '241' })).graceMinutes);
  assert.ok(validateShift(form({ graceMinutes: '' })).graceMinutes);
  assert.deepEqual(validateShift(form({ graceMinutes: '240' })), {});
  assert.ok(validateShift(form({ workDays: [] })).workDays);
});

test('schedule body: numbers, trimmed name, sorted days; change detection ignores order', () => {
  assert.deepEqual(buildShift(form({ name: ' Day ', graceMinutes: ' 10 ', workDays: [5, 1, 3] })),
    { name: 'Day', startTime: '09:00', endTime: '17:00', graceMinutes: 10, workDays: [1, 3, 5] });
  const same = form({ graceMinutes: '10', workDays: [5, 4, 3, 2, 1] });
  assert.equal(shiftChanged(same, SHIFT), false);
  assert.equal(shiftChanged({ ...same, workDays: [1, 2, 3, 4, 5, 6] }, SHIFT), true);
  assert.equal(shiftChanged({ ...same, graceMinutes: '15' }, SHIFT), true);
  assert.equal(shiftChanged({ ...same, endTime: '16:00' }, SHIFT), true);
});

test('schedule row: hours, grace text, work days and head count', () => {
  assert.deepEqual(shiftRow(SHIFT), { id: 1, name: 'Day', hours: '09:00–17:00', grace: '10 min', days: 'Mon–Fri', count: 12 });
  assert.equal(shiftRow({ ...SHIFT, graceMinutes: 0 }).grace, 'None');
});

test('save errors: field messages stay under the inputs; network failures say nothing was saved', () => {
  assert.deepEqual(saveErrorView({ fields: { date: 'A holiday is already set on this date' }, message: 'x' }), { fields: { date: 'A holiday is already set on this date' }, message: '' });
  assert.match(saveErrorView({ status: 0, code: 'network' }).message, /Nothing was saved/);
  assert.equal(saveErrorView({ message: 'Holiday not found' }).message, 'Holiday not found');
  assert.match(saveErrorView(null).message, /Nothing was saved/);
});
