import { formatWorkDate } from '../attendanceForm.js';

// Pure helpers for the employee leave page (task 3.5): status text/colour, balance cards, request rows, form rules and
// error mapping. Dates are plain 'YYYY-MM-DD' strings from the server and are never converted with the phone's time zone.

export const STATUS = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'danger'], cancelled: ['Cancelled', 'neutral'] };
export const statusInfo = (s) => { const [label, tone] = STATUS[s] ?? ['—', 'neutral']; return { label, tone }; };

export const dayWord = (n) => `${n} day${n === 1 ? '' : 's'}`;

// 'Mon 2 Nov 2026' for one day, 'Mon 2 Nov 2026 – Fri 6 Nov 2026' for a range.
export const formatRange = (start, end) => (start === end ? formatWorkDate(start) : `${formatWorkDate(start)} – ${formatWorkDate(end)}`);

// One balance card from GET /leave/balances. Unlimited types (unpaid) have no remaining number.
export function balanceView(b) {
  const parts = [`Used ${b.used}`, `pending ${b.pending}`];
  if (b.adjusted) parts.push(`HR adjustment ${b.adjusted > 0 ? '+' : ''}${b.adjusted}`);
  return {
    id: b.leaveTypeId, name: b.name,
    headline: b.hasBalance ? `${b.remaining} of ${dayWord(b.total)} left` : 'No limit',
    detail: b.hasBalance ? parts.join(' · ') : `Used ${b.used} · pending ${b.pending} · unpaid`,
    empty: b.hasBalance && b.remaining <= 0,
  };
}

export function requestRow(r) {
  const { label, tone } = statusInfo(r.status);
  return { id: r.id, type: r.leaveTypeName, dates: formatRange(r.startDate, r.endDate), days: r.days, status: label, tone,
    remarks: r.decisionRemarks ?? '', canCancel: r.status === 'pending' };
}

export const EMPTY_FORM = { leaveTypeId: '', startDate: '', endDate: '', reason: '' };
export const MIN_REASON = 3;

// Mirrors the server's cheap rules so the person gets an answer without a round trip; the server stays the authority
// (working days, overlap and balance are only known there).
export function validateLeaveForm(f) {
  const e = {};
  if (!f.leaveTypeId) e.leaveTypeId = 'Choose a leave type';
  if (!f.startDate) e.startDate = 'Choose a start date';
  if (!f.endDate) e.endDate = 'Choose an end date';
  else if (f.startDate && f.endDate < f.startDate) e.endDate = 'Must be on or after the start date';
  else if (f.startDate && f.startDate.slice(0, 4) !== f.endDate.slice(0, 4)) e.endDate = 'A request must stay within one calendar year. Submit one request per year';
  if (f.reason.trim().length < MIN_REASON) e.reason = `Give a reason (at least ${MIN_REASON} characters)`;
  return e;
}

export const buildLeaveBody = (f) => ({ leaveTypeId: Number(f.leaveTypeId), startDate: f.startDate, endDate: f.endDate, reason: f.reason.trim() });

// A failed request/cancel -> { fields, message }. Field messages go under the inputs; `message` is for the top of the form
// and is empty when the fields already explain everything.
export function leaveErrorView(err) {
  const fields = err?.fields ?? {};
  if (Object.keys(fields).length) return { fields, message: '' };
  if (err?.code === 'employee_inactive' || err?.code === 'no_employee_record') return { fields: {}, message: err.message };
  if (err?.status === 0 || err?.code === 'network') return { fields: {}, message: 'Cannot reach the server. Your request was not sent. Check your connection and try again.' };
  return { fields: {}, message: err?.message || 'Something went wrong. Your request may not have been sent: check the list below before trying again.' };
}
