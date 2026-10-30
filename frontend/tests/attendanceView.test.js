import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationView, describeScanError, historyRow, statusText, stripDataUrl } from '../src/pages/portal/attendanceView.js';

const CHECK_IN = { action: 'check_in', workDate: '2026-10-28', employee: { fullName: 'Eli Employee', employeeCode: 'E-1' }, atTime: '09:12', checkInTime: '09:12', checkOutTime: null, status: 'late', lateMinutes: 12 };

test('confirmation shows name, date, time, in/out and status (spec 7 step 5)', () => {
  const v = confirmationView(CHECK_IN);
  assert.deepEqual(v, { heading: 'Checked in', name: 'Eli Employee', code: 'E-1', date: 'Wed 28 Oct 2026', time: '09:12', checkIn: '09:12', checkOut: '—', status: 'Late (12 min)', tone: 'warn' });
  const out = confirmationView({ ...CHECK_IN, action: 'check_out', atTime: '17:03', checkOutTime: '17:03' });
  assert.equal(out.heading, 'Checked out');
  assert.equal(out.time, '17:03');
  assert.equal(out.checkOut, '17:03');
  assert.equal(out.checkIn, '09:12');
});

test('confirmation survives a missing or odd payload without throwing', () => {
  const v = confirmationView({});
  assert.equal(v.heading, 'Attendance recorded');
  assert.equal(v.date, '—');
  assert.equal(v.time, '—');
  assert.equal(confirmationView(null).name, '');
});

test('status text: late shows minutes, others do not', () => {
  assert.equal(statusText('present', 0), 'Present');
  assert.equal(statusText('late', 5), 'Late (5 min)');
  assert.equal(statusText('late', 0), 'Late');
  assert.equal(statusText('on_leave', 0), 'On approved leave');
  assert.equal(statusText('weird', 0), '—');
});

const err = (status, code, extra = {}) => Object.assign(new Error(extra.message ?? 'x'), { status, code, ...extra });

test('scan errors map to a plain message and a next step', () => {
  assert.equal(describeScanError(err(0, 'network')).next, 'retry');
  for (const [s, c] of [[400, 'invalid_token'], [410, 'token_expired'], [409, 'token_used']]) assert.equal(describeScanError(err(s, c)).next, 'rescan');
  assert.equal(describeScanError(err(409, 'already_checked_out')).next, 'stop');
  assert.equal(describeScanError(err(409, 'on_leave')).next, 'stop');
  assert.equal(describeScanError(err(403, 'employee_inactive', { message: 'Your employee record is inactive. Contact HR.' })).message, 'Your employee record is inactive. Contact HR.');
  assert.equal(describeScanError(err(409, 'duplicate_scan')).next, 'retry');
  assert.equal(describeScanError(err(413, 'too_large')).next, 'retake');
  assert.equal(describeScanError(err(400, 'validation', { fields: { photo: 'bad' } })).next, 'retake');
  assert.equal(describeScanError(err(400, 'validation', { fields: { token: 'bad' } })).next, 'retry');
  for (const s of [502, 503]) assert.match(describeScanError(err(s, 'server_error')).message, /not recorded/);
  assert.equal(describeScanError(undefined).next, 'retry');
});

test('rate-limit message rounds up to whole minutes and is singular for one', () => {
  assert.match(describeScanError(err(429, 'rate_limited', { details: { retryAfterSeconds: 61 } })).message, /2 minutes/);
  assert.match(describeScanError(err(429, 'rate_limited', { details: { retryAfterSeconds: 30 } })).message, /1 minute\./);
  assert.match(describeScanError(err(429, 'rate_limited')).message, /1 minute\./);
});

test('error messages never contain the raw server text, a token or a photo id', () => {
  for (const e of [err(500, 'server_error', { message: 'relation "attendance_tokens" does not exist' }), err(502, 'server_error', { message: 'natra/selfies/2026/abc' })]) {
    assert.doesNotMatch(describeScanError(e).message, /relation|natra\/selfies|token/i);
  }
});

test('history rows use company-time strings as they are', () => {
  assert.deepEqual(historyRow({ id: 3, workDate: '2026-10-27', checkInTime: '09:10', checkOutTime: null, status: 'late', lateMinutes: 10, corrected: true }),
    { id: 3, date: 'Tue 27 Oct 2026', checkIn: '09:10', checkOut: '—', status: 'Late (10 min)', tone: 'warn', corrected: true });
  assert.equal(historyRow({ id: 1, workDate: '2026-10-26', status: 'absent', lateMinutes: 0 }).checkIn, '—');
});

test('stripDataUrl removes only the data: prefix', () => {
  assert.equal(stripDataUrl('data:image/jpeg;base64,/9j/AAAA'), '/9j/AAAA');
  assert.equal(stripDataUrl('/9j/AAAA'), '/9j/AAAA');
  assert.equal(stripDataUrl(null), '');
});


test('a repeated shared QR stops retries and points to attendance history', () => {
  const view=describeScanError(err(409,'token_already_scanned'));
  assert.equal(view.next,'stop');
  assert.match(view.message,/history/);
});
