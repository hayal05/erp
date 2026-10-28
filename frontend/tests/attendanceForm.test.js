import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_LABEL, STATUS_TONE, STATUS_OPTIONS, formatWorkDate, formFromRecord, validateCorrection, buildCorrection, hasChanges } from '../src/pages/attendanceForm.js';

const rec = { id: 5, status: 'late', checkInTime: '09:40', checkOutTime: '17:00', lateMinutes: 40, workDate: '2026-10-19', fullName: 'Ann', employeeCode: 'E-1' };
const REASON = 'Supervisor confirmed';
const form = (over = {}) => ({ ...formFromRecord(rec), reason: REASON, ...over });

test('every status has a label and a tone; options match', () => {
  for (const o of STATUS_OPTIONS) { assert.ok(STATUS_LABEL[o.value]); assert.ok(STATUS_TONE[o.value]); }
  assert.deepEqual(STATUS_OPTIONS.map((o) => o.value), ['present', 'late', 'absent', 'on_leave', 'incomplete']);
});

test('formatWorkDate reads a calendar date, not a time zone', () => {
  assert.equal(formatWorkDate('2026-10-19'), 'Mon 19 Oct 2026');
  assert.equal(formatWorkDate('2026-01-01'), 'Thu 1 Jan 2026');
  assert.equal(formatWorkDate(null), '—');
  assert.equal(formatWorkDate('19/10/2026'), '—');
});

test('formFromRecord: strings for inputs, empty for missing times, minutes only for Late, reason blank', () => {
  assert.deepEqual(formFromRecord(rec), { status: 'late', checkInTime: '09:40', checkOutTime: '17:00', lateMinutes: '40', reason: '' });
  assert.deepEqual(formFromRecord({ ...rec, status: 'absent', checkInTime: null, checkOutTime: null, lateMinutes: 0 }),
    { status: 'absent', checkInTime: '', checkOutTime: '', lateMinutes: '', reason: '' });
});

test('a reason is required (trimmed, at least 3 characters)', () => {
  assert.deepEqual(validateCorrection(form()), {});
  for (const reason of ['', '   ', 'ok']) assert.ok(validateCorrection(form({ reason })).reason, reason);
});

test('Present/Late need a check-in time; a check-out needs one and must be later', () => {
  assert.ok(validateCorrection(form({ status: 'present', checkInTime: '' })).checkInTime);
  assert.ok(validateCorrection(form({ status: 'late', checkInTime: '' })).checkInTime);
  assert.equal(validateCorrection(form({ status: 'absent', checkInTime: '', checkOutTime: '' })).checkInTime, undefined);
  assert.ok(validateCorrection(form({ status: 'absent', checkInTime: '', checkOutTime: '17:00' })).checkOutTime);
  assert.ok(validateCorrection(form({ checkOutTime: '09:40' })).checkOutTime); // equal is not later
  assert.ok(validateCorrection(form({ checkOutTime: '08:00' })).checkOutTime);
  assert.equal(validateCorrection(form({ checkOutTime: '' })).checkOutTime, undefined); // clearing is fine
});

test('minutes late: blank is allowed (server recomputes); typed values must be whole minutes >= 1', () => {
  assert.deepEqual(validateCorrection(form({ lateMinutes: '' })), {});
  for (const bad of ['0', '-5', '1.5', 'ten', '12345']) assert.ok(validateCorrection(form({ lateMinutes: bad })).lateMinutes, bad);
  assert.equal(validateCorrection(form({ status: 'present', lateMinutes: 'junk' })).lateMinutes, undefined); // not shown for other statuses
});

test('buildCorrection sends the reason plus only what changed; cleared times are null', () => {
  assert.deepEqual(buildCorrection(form(), rec), { reason: REASON });
  assert.deepEqual(buildCorrection(form({ reason: `  ${REASON} ` }), rec), { reason: REASON });
  assert.deepEqual(buildCorrection(form({ status: 'present' }), rec), { reason: REASON, status: 'present' });
  assert.deepEqual(buildCorrection(form({ checkInTime: '09:05', checkOutTime: '' }), rec), { reason: REASON, checkInTime: '09:05', checkOutTime: null });
  assert.deepEqual(buildCorrection(form({ lateMinutes: '12' }), rec), { reason: REASON, lateMinutes: 12 });
  assert.deepEqual(buildCorrection(form({ lateMinutes: '40' }), rec), { reason: REASON }); // unchanged minutes are not re-sent
});

test('late minutes are never sent for a non-Late status', () => {
  assert.equal('lateMinutes' in buildCorrection(form({ status: 'present', lateMinutes: '12' }), rec), false);
});

test('switching to Late with blank minutes lets the server calculate them', () => {
  const present = { ...rec, status: 'present', lateMinutes: 0 };
  assert.deepEqual(buildCorrection({ ...formFromRecord(present), status: 'late', reason: REASON }, present), { reason: REASON, status: 'late' });
});

test('hasChanges ignores the reason', () => {
  assert.equal(hasChanges(form(), rec), false);
  assert.equal(hasChanges(form({ reason: 'something else entirely' }), rec), false);
  assert.equal(hasChanges(form({ checkOutTime: '' }), rec), true);
  assert.equal(hasChanges(form({ status: 'absent' }), rec), true);
});
