import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_FILTERS, buildBalanceChange, buildDecision, hrLeaveErrorView, previewTotal, queueRow, validateBalanceChange, validateDecision } from '../src/pages/leaveAdminView.js';

const REQ = { id: 7, employeeId: 3, employeeCode: 'E-003', employeeName: 'Abel Tesfaye', leaveTypeName: 'Annual leave', startDate: '2026-11-02', endDate: '2026-11-06',
  days: 5, reason: 'Family trip', status: 'pending', decisionRemarks: null };
const BAL = { leaveTypeId: 1, name: 'Annual leave', hasBalance: true, entitled: 16, adjusted: 2, total: 18, used: 3, pending: 4, remaining: 11 };

test('the queue defaults to pending requests', () => {
  assert.equal(NO_FILTERS.status, 'pending');
});

test('queue row: employee, text status, dates; only a pending request can be decided', () => {
  const r = queueRow(REQ);
  assert.deepEqual([r.employee, r.code, r.type, r.days, r.status, r.tone, r.canDecide], ['Abel Tesfaye', 'E-003', 'Annual leave', 5, 'Pending', 'warn', true]);
  assert.match(r.dates, /2 Nov 2026.*6 Nov 2026/);
  for (const status of ['approved', 'rejected', 'cancelled']) assert.equal(queueRow({ ...REQ, status }).canDecide, false, status);
  assert.equal(queueRow({ ...REQ, status: 'rejected', decisionRemarks: 'Busy week' }).remarks, 'Busy week');
  assert.equal(queueRow({ ...REQ, reason: null }).reason, '');
});

test('rejecting needs a reason of at least 3 characters; approving does not', () => {
  assert.deepEqual(validateDecision('approve', ''), {});
  assert.ok(validateDecision('reject', '').remarks);
  assert.ok(validateDecision('reject', '  no ').remarks);
  assert.deepEqual(validateDecision('reject', ' Peak season '), {});
});

test('decision body carries trimmed remarks, or nothing', () => {
  assert.deepEqual(buildDecision('  Enjoy  '), { remarks: 'Enjoy' });
  assert.deepEqual(buildDecision('   '), {});
  assert.deepEqual(buildDecision(undefined), {});
});

test('balance change: something to change and a reason are both required', () => {
  assert.ok(validateBalanceChange({ entitledDays: '', adjustDays: '', reason: 'Carry over' }).entitledDays);
  assert.ok(validateBalanceChange({ entitledDays: '5', adjustDays: '', reason: '' }).reason);
  assert.ok(validateBalanceChange({ entitledDays: '5', adjustDays: '', reason: 'ab' }).reason);
  assert.deepEqual(validateBalanceChange({ entitledDays: '20', adjustDays: '', reason: 'New policy' }), {});
  assert.deepEqual(validateBalanceChange({ entitledDays: '', adjustDays: '-1', reason: 'Correction' }), {});
});

test('balance change: whole days only, within the server limits', () => {
  const ok = { reason: 'Because' };
  assert.ok(validateBalanceChange({ ...ok, entitledDays: '-3', adjustDays: '' }).entitledDays);
  assert.ok(validateBalanceChange({ ...ok, entitledDays: '2.5', adjustDays: '' }).entitledDays);
  assert.ok(validateBalanceChange({ ...ok, entitledDays: '367', adjustDays: '' }).entitledDays);
  assert.deepEqual(validateBalanceChange({ ...ok, entitledDays: '366', adjustDays: '' }), {});
  assert.ok(validateBalanceChange({ ...ok, entitledDays: '', adjustDays: '1.5' }).adjustDays);
  assert.ok(validateBalanceChange({ ...ok, entitledDays: '', adjustDays: 'abc' }).adjustDays);
  assert.ok(validateBalanceChange({ ...ok, entitledDays: '', adjustDays: '-367' }).adjustDays);
  assert.deepEqual(validateBalanceChange({ ...ok, entitledDays: '', adjustDays: '+2' }), {});
});

test('balance change body: numbers, trimmed reason, blank fields left out', () => {
  const ctx = { employeeId: '3', leaveTypeId: 1, year: '2026' };
  assert.deepEqual(buildBalanceChange({ entitledDays: ' 20 ', adjustDays: '', reason: ' New policy ' }, ctx),
    { employeeId: 3, leaveTypeId: 1, year: 2026, reason: 'New policy', entitledDays: 20 });
  assert.deepEqual(buildBalanceChange({ entitledDays: '', adjustDays: '-2', reason: 'Fix' }, ctx),
    { employeeId: 3, leaveTypeId: 1, year: 2026, reason: 'Fix', adjustDays: -2 });
  // entitlement 0 is a real value and must not be dropped as "blank"
  assert.equal(buildBalanceChange({ entitledDays: '0', adjustDays: '', reason: 'None this year' }, ctx).entitledDays, 0);
});

test('preview: entitlement is replaced, the adjustment is added to the existing one', () => {
  assert.equal(previewTotal(BAL, { entitledDays: '', adjustDays: '' }).total, 18);
  assert.equal(previewTotal(BAL, { entitledDays: '20', adjustDays: '' }).total, 22);        // 20 + existing +2
  assert.equal(previewTotal(BAL, { entitledDays: '', adjustDays: '-3' }).total, 15);        // 16 + (2 - 3)
  assert.equal(previewTotal(BAL, { entitledDays: '', adjustDays: '1' }).remaining, 12);     // 19 - 3 - 4
  assert.equal(previewTotal(BAL, { entitledDays: '', adjustDays: '' }).text, '18 days in total, 11 left');
  assert.equal(previewTotal(BAL, { entitledDays: 'x', adjustDays: '' }), null);
  assert.equal(previewTotal(BAL, { entitledDays: '', adjustDays: '1.5' }).total, 18);        // not a whole number: ignored until valid
});

test('errors: field messages go under the inputs; a stale decision refreshes the list', () => {
  assert.deepEqual(hrLeaveErrorView({ fields: { remarks: 'Too short' }, message: 'x' }), { fields: { remarks: 'Too short' }, message: '' });
  const stale = hrLeaveErrorView({ code: 'not_pending', message: 'Only pending' });
  assert.equal(stale.stale, true);
  assert.match(stale.message, /already decided/);
  assert.match(hrLeaveErrorView({ status: 0, code: 'network' }).message, /Nothing was saved/);
  assert.equal(hrLeaveErrorView({ code: 'leave_overlap', message: 'Overlaps approved leave' }).message, 'Overlaps approved leave');
  assert.equal(hrLeaveErrorView({ code: 'below_used', message: 'Below used days' }).message, 'Below used days');
  assert.match(hrLeaveErrorView(null).message, /Nothing was saved/);
});
