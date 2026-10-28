// Pure helpers for the HR attendance page and the correction dialog (kept free of React so they are unit-tested).
// The server is the authority (task 2.18, routes/attendanceRecords.js); these checks only save a round trip and shape the payload.

export const STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'on_leave', label: 'On approved leave' },
  { value: 'incomplete', label: 'Incomplete' },
];
export const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
export const STATUS_TONE = { present: 'ok', late: 'warn', absent: 'danger', on_leave: 'info', incomplete: 'warn' };
export const MIN_REASON = 3;

// 'YYYY-MM-DD' -> "Mon 19 Oct 2026". Read as a plain calendar date (UTC getters) so the viewer's time zone cannot shift it,
// and built by hand so the format does not vary between browsers/ICU versions.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatWorkDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return '—';
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const formFromRecord = (r) => ({
  status: r.status,
  checkInTime: r.checkInTime ?? '',
  checkOutTime: r.checkOutTime ?? '',
  lateMinutes: r.status === 'late' && r.lateMinutes > 0 ? String(r.lateMinutes) : '',
  reason: '',
});

const trim = (s) => String(s ?? '').trim();

// Returns { field: message } (empty = fine). HH:MM strings compare correctly as text.
export function validateCorrection(form) {
  const e = {};
  const inn = trim(form.checkInTime), out = trim(form.checkOutTime), mins = trim(form.lateMinutes);
  if (trim(form.reason).length < MIN_REASON) e.reason = `Enter the reason for this correction (at least ${MIN_REASON} characters)`;
  if (['present', 'late'].includes(form.status) && !inn) e.checkInTime = 'Enter the check-in time for Present or Late';
  if (out && !inn) e.checkOutTime = 'A check-out needs a check-in time';
  else if (out && inn && out <= inn) e.checkOutTime = 'Must be after the check-in time';
  if (form.status === 'late' && mins && !/^[1-9]\d{0,3}$/.test(mins)) e.lateMinutes = 'Whole minutes, at least 1';
  return e;
}

// True when anything other than the reason differs from the record (what the server calls a change).
export const hasChanges = (form, record) => Object.keys(buildCorrection({ ...form, reason: 'x' }, record)).length > 1;

// PATCH body: the reason always, plus ONLY the fields that changed. A cleared time is null; late minutes are sent only for Late and
// only when typed and different (left blank, the server recomputes them from the shift, or keeps them if the times did not change).
export function buildCorrection(form, record) {
  const body = { reason: trim(form.reason) };
  if (form.status !== record.status) body.status = form.status;
  for (const [key, recKey] of [['checkInTime', 'checkInTime'], ['checkOutTime', 'checkOutTime']]) {
    const now = trim(form[key]), was = record[recKey] ?? '';
    if (now !== was) body[key] = now || null;
  }
  const mins = trim(form.lateMinutes);
  if (form.status === 'late' && mins && Number(mins) !== record.lateMinutes) body.lateMinutes = Number(mins);
  return body;
}
