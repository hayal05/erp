import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceView, buildLeaveBody, formatRange, leaveErrorView, requestRow, statusInfo, validateLeaveForm } from '../src/pages/portal/leaveView.js';

const BAL = { leaveTypeId: 1, name: 'Annual leave', hasBalance: true, entitled: 16, adjusted: 2, total: 18, used: 3, pending: 4, remaining: 11 };

test('balance card: remaining of total, used and pending, HR adjustment only when there is one', () => {
  assert.deepEqual(balanceView(BAL), { id: 1, name: 'Annual leave', headline: '11 of 18 days left', detail: 'Used 3 · pending 4 · HR adjustment +2', empty: false });
  assert.equal(balanceView({ ...BAL, adjusted: 0 }).detail, 'Used 3 · pending 4');
  assert.equal(balanceView({ ...BAL, adjusted: -1 }).detail, 'Used 3 · pending 4 · HR adjustment -1');
  assert.equal(balanceView({ ...BAL, total: 1, remaining: 1 }).headline, '1 of 1 day left');
  assert.equal(balanceView({ ...BAL, remaining: 0 }).empty, true);
});

test('unlimited leave (unpaid) shows no limit and is never "empty"', () => {
  const v = balanceView({ ...BAL, name: 'Unpaid leave', hasBalance: false, remaining: null, total: 0, used: 2, pending: 0, adjusted: 0 });
  assert.deepEqual([v.headline, v.detail, v.empty], ['No limit', 'Used 2 · pending 0 · unpaid', false]);
});

test('status is text plus a tone, and unknown statuses do not crash', () => {
  assert.deepEqual(statusInfo('pending'), { label: 'Pending', tone: 'warn' });
  assert.deepEqual(statusInfo('approved'), { label: 'Approved', tone: 'ok' });
  assert.deepEqual(statusInfo('rejected'), { label: 'Rejected', tone: 'danger' });
  assert.deepEqual(statusInfo('cancelled'), { label: 'Cancelled', tone: 'neutral' });
  assert.deepEqual(statusInfo('weird'), { label: '—', tone: 'neutral' });
});

test('dates: a range or a single day, no time-zone shifting', () => {
  assert.equal(formatRange('2026-11-02', '2026-11-06'), 'Mon 2 Nov 2026 – Fri 6 Nov 2026');
  assert.equal(formatRange('2026-11-02', '2026-11-02'), 'Mon 2 Nov 2026');
});

test('request row: only pending can be cancelled; HR remarks are carried', () => {
  const base = { id: 7, leaveTypeName: 'Sick leave', startDate: '2026-11-02', endDate: '2026-11-03', days: 2, status: 'pending', decisionRemarks: null };
  assert.deepEqual(requestRow(base), { id: 7, type: 'Sick leave', dates: 'Mon 2 Nov 2026 – Tue 3 Nov 2026', days: 2, status: 'Pending', tone: 'warn', remarks: '', canCancel: true });
  const rejected = requestRow({ ...base, status: 'rejected', decisionRemarks: 'Busy season' });
  assert.deepEqual([rejected.canCancel, rejected.remarks, rejected.status], [false, 'Busy season', 'Rejected']);
  assert.equal(requestRow({ ...base, status: 'approved' }).canCancel, false);
});

const OK = { leaveTypeId: '1', startDate: '2026-11-02', endDate: '2026-11-06', reason: 'Family visit' };

test('form rules mirror the server: type, dates in order and in one year, a reason', () => {
  assert.deepEqual(validateLeaveForm(OK), {});
  assert.deepEqual(Object.keys(validateLeaveForm({ leaveTypeId: '', startDate: '', endDate: '', reason: ' ' })).sort(), ['endDate', 'leaveTypeId', 'reason', 'startDate']);
  assert.match(validateLeaveForm({ ...OK, endDate: '2026-11-01' }).endDate, /on or after/);
  assert.match(validateLeaveForm({ ...OK, startDate: '2026-12-30', endDate: '2027-01-04' }).endDate, /one calendar year/);
  assert.ok(validateLeaveForm({ ...OK, reason: 'ab' }).reason);
  assert.deepEqual(validateLeaveForm({ ...OK, endDate: OK.startDate }), {}); // one day is fine
});

test('request body: numeric type id, trimmed reason, and no day count (the server counts)', () => {
  assert.deepEqual(buildLeaveBody({ ...OK, reason: '  Family visit  ' }), { leaveTypeId: 1, startDate: '2026-11-02', endDate: '2026-11-06', reason: 'Family visit' });
});

test('server errors: field messages go under the inputs, anything else becomes one message', () => {
  const overlap = Object.assign(new Error('x'), { status: 409, code: 'leave_overlap', fields: { startDate: 'You already have approved leave from 2026-11-09 to 2026-11-13' } });
  assert.deepEqual(leaveErrorView(overlap), { fields: overlap.fields, message: '' });
  assert.match(leaveErrorView({ status: 0, code: 'network', fields: {} }).message, /Cannot reach the server/);
  assert.equal(leaveErrorView(Object.assign(new Error('Your employee record is inactive. Contact HR.'), { status: 403, code: 'employee_inactive', fields: {} })).message, 'Your employee record is inactive. Contact HR.');
  assert.match(leaveErrorView(undefined).message, /Something went wrong/);
});
