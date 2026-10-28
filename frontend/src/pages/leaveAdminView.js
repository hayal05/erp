import { dayWord, formatRange, statusInfo } from './portal/leaveView.js';

// Pure helpers for the HR leave page (task 3.6): queue rows, decision and entitlement form rules, error mapping.
// Dates are plain 'YYYY-MM-DD' strings from the server and are never converted with the browser's time zone.

export const MIN_TEXT = 3; // remarks / reasons: same minimum as the server schemas

export const STATUS_FILTER = [
  { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }, { value: 'cancelled', label: 'Cancelled' },
];
export const NO_FILTERS = { status: 'pending', employeeId: '', departmentId: '', year: '' };

// One queue row from GET /leave-admin/requests. Only a pending request can be decided.
export function queueRow(r) {
  const { label, tone } = statusInfo(r.status);
  return { id: r.id, employee: r.employeeName, code: r.employeeCode, type: r.leaveTypeName, dates: formatRange(r.startDate, r.endDate),
    days: r.days, reason: r.reason ?? '', status: label, tone, remarks: r.decisionRemarks ?? '', canDecide: r.status === 'pending' };
}

// ---- Approve / reject dialog
// Approving needs no remarks; rejecting does (the DB refuses a rejection without them).
export function validateDecision(decision, remarks) {
  const text = String(remarks ?? '').trim();
  if (decision === 'reject' && text.length < MIN_TEXT) return { remarks: `Give a reason for rejecting (at least ${MIN_TEXT} characters)` };
  return {};
}
export const buildDecision = (remarks) => { const t = String(remarks ?? '').trim(); return t ? { remarks: t } : {}; };

// ---- Entitlement dialog (POST /leave-admin/balances)
// `entitledDays` is SET (absolute); `adjustDays` is a signed CHANGE. Either may be left blank, but not both; reason is required.
export const EMPTY_CHANGE = { entitledDays: '', adjustDays: '', reason: '' };
const WHOLE = /^[+-]?\d+$/;

export function validateBalanceChange(f) {
  const e = {};
  const ent = String(f.entitledDays).trim(), adj = String(f.adjustDays).trim();
  if (!ent && !adj) e.entitledDays = 'Set the yearly entitlement, change it by some days, or both';
  if (ent && (!/^\d+$/.test(ent) || Number(ent) > 366)) e.entitledDays = 'Whole days from 0 to 366';
  if (adj && (!WHOLE.test(adj) || Math.abs(Number(adj)) > 366)) e.adjustDays = 'Whole days, for example 2 or -1';
  if (String(f.reason).trim().length < MIN_TEXT) e.reason = `Give a reason (at least ${MIN_TEXT} characters). It is kept in the audit log`;
  return e;
}

export function buildBalanceChange(f, { employeeId, leaveTypeId, year }) {
  const body = { employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId), year: Number(year), reason: String(f.reason).trim() };
  if (String(f.entitledDays).trim()) body.entitledDays = Number(f.entitledDays);
  if (String(f.adjustDays).trim()) body.adjustDays = Number(f.adjustDays);
  return body;
}

// What the balance will look like if the change is saved, for a live preview in the dialog ("Total 18 days, 13 left").
// The server is the authority (it also refuses a total below the days already approved or pending).
export function previewTotal(balance, f) {
  const ent = String(f.entitledDays).trim() ? Number(f.entitledDays) : balance.entitled;
  const adj = balance.adjusted + (String(f.adjustDays).trim() && WHOLE.test(String(f.adjustDays).trim()) ? Number(f.adjustDays) : 0);
  if (!Number.isFinite(ent) || !Number.isFinite(adj)) return null;
  const total = ent + adj;
  return { total, remaining: total - balance.used - balance.pending, text: `${dayWord(total)} in total, ${total - balance.used - balance.pending} left` };
}

// A failed decision / balance change -> { fields, message }. Field messages sit under the inputs; `message` is for the top.
export function hrLeaveErrorView(err) {
  const fields = err?.fields ?? {};
  if (Object.keys(fields).length) return { fields, message: '' };
  if (err?.status === 0 || err?.code === 'network') return { fields: {}, message: 'Cannot reach the server. Nothing was saved. Check your connection and try again.' };
  if (err?.code === 'not_pending') return { fields: {}, message: 'This request was already decided or withdrawn. The list has been refreshed.', stale: true };
  if (err?.code === 'leave_overlap') return { fields: {}, message: err.message };
  return { fields: {}, message: err?.message || 'Something went wrong. Nothing was saved.' };
}
