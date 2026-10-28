import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attendanceAmounts, loadAttendanceDeductions, parseAttendancePolicy } from '../src/services/payrollAttendance.js';
const settings = { absenceDeductionEnabled: true, unpaidLeaveDeductionEnabled: true, roundingMode: 'half_up' };
test('attendance deductions apply basic salary to disjoint absence and unpaid counts', () => {
  const items = attendanceAmounts({ basicMinor: 220000, workingDays: 22, absentDays: 2, unpaidDays: 3, settings });
  assert.deepEqual(items.map((i) => [i.kind,i.amountMinor]), [['absence',20000],['unpaid_leave',30000]]);
});
test('attendance switches, zero salary and zero working days produce no deductions', () => {
  const base = { basicMinor: 10000, workingDays: 20, absentDays: 2, unpaidDays: 1, settings };
  assert.deepEqual(attendanceAmounts({ ...base, settings: {} }), []);
  assert.deepEqual(attendanceAmounts({ ...base, basicMinor: 0 }), []);
  assert.deepEqual(attendanceAmounts({ ...base, workingDays: 0, absentDays: 0, unpaidDays: 0 }), []);
  assert.deepEqual(attendanceAmounts({ ...base, settings: { unpaidLeaveDeductionEnabled: true } }).map((i) => i.amountMinor), [500]);
});
test('round once across categories so a full-month deduction never exceeds basic salary', () => {
  for (const roundingMode of ['half_up','half_even','up','down']) {
    const items = attendanceAmounts({ basicMinor: 1, workingDays: 2, absentDays: 1, unpaidDays: 1, settings: { ...settings, roundingMode } });
    assert.equal(items.reduce((s,i) => s+i.amountMinor,0), 1);
  }
  assert.throws(() => attendanceAmounts({ basicMinor: 100, workingDays: 2, absentDays: 2, unpaidDays: 1, settings }));
});
test('loader skips database when disabled and maps working-day counts when enabled', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({sql,params}); return { rows: [{ working_days: 22, absent_days: 2, unpaid_days: 1 }] }; } };
  assert.deepEqual(await loadAttendanceDeductions(db, { settings: {} }), []);
  assert.equal(calls.length, 0);
  const items = await loadAttendanceDeductions(db, { employeeId: 4, month: '2026-10', basicMinor: 220000, settings });
  assert.equal(items[0].amountMinor, 20000);
  assert.equal(calls[0].params[1], '2026-10-01');
});
test('attendance policy accepts only boolean switches and rejects empty changes', () => {
  assert.deepEqual(parseAttendancePolicy({ absenceDeductionEnabled: true, netMinor: 1 }).value, { absenceDeductionEnabled: true });
  for (const body of [{}, { absenceDeductionEnabled: 'true' }, null]) assert.ok(parseAttendancePolicy(body).errors);
});
