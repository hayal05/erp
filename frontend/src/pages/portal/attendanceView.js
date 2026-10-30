import { STATUS_LABEL, STATUS_TONE, formatWorkDate } from '../attendanceForm.js';

// Pure helpers for the employee side of attendance (task 2.19): the scan confirmation, the scan error messages and the
// history rows. Times arrive from the server as 'HH:MM' in the COMPANY timezone and are shown as they are, never
// converted with the phone's time zone.

export const ACTION_LABEL = { check_in: 'Checked in', check_out: 'Checked out' };

// 'Late (12 min)' / 'Present'. Status colour is always paired with this text.
export function statusText(status, lateMinutes) {
  const label = STATUS_LABEL[status] ?? '—';
  return status === 'late' && lateMinutes > 0 ? `${label} (${lateMinutes} min)` : label;
}
export const statusTone = (status) => STATUS_TONE[status] ?? 'neutral';

// 201 body of POST /attendance/scan -> what the confirmation card shows (spec 7 step 5: name, date, time, in/out, status).
export function confirmationView(res) {
  return {
    heading: ACTION_LABEL[res?.action] ?? 'Attendance recorded',
    name: res?.employee?.fullName ?? '',
    code: res?.employee?.employeeCode ?? '',
    date: formatWorkDate(res?.workDate),
    time: res?.atTime ?? '—',
    checkIn: res?.checkInTime ?? '—',
    checkOut: res?.checkOutTime ?? '—',
    status: statusText(res?.status, res?.lateMinutes),
    tone: statusTone(res?.status),
  };
}

const minutes = (s) => Math.max(1, Math.ceil((Number(s) || 0) / 60));

// A failed scan -> { message, next } where next says what the person can do:
//   'retry'  same photo and same code can be sent again (nothing was recorded, the code is still valid until it expires)
//   'retake' the photo itself was refused
//   'rescan' the code cannot be used any more: ask HR for a new QR and scan again
//   'stop'   nothing to retry (already done today, on leave, account problem)
export function describeScanError(err) {
  const status = err?.status ?? 0;
  const code = err?.code ?? '';
  if (status === 0 || code === 'network') return { next: 'retry', message: 'Cannot reach the server. Your attendance was not recorded. Check your connection and try again.' };
  if (code === 'token_already_scanned') return { next: 'stop', message: 'You already recorded attendance with this QR code. Check your attendance history. Use a new code when checking out.' };
  if (code === 'invalid_token' || code === 'token_expired' || code === 'token_used') {
    return { next: 'rescan', message: 'This QR code has expired or was already used. Ask HR to show a new one on the tablet and scan it again.' };
  }
  if (code === 'already_checked_out') return { next: 'stop', message: 'You have already checked in and out today. Nothing more to record.' };
  if (code === 'on_leave') return { next: 'stop', message: 'You are on approved leave today, so there is nothing to record.' };
  if (code === 'employee_inactive' || code === 'no_employee_record') return { next: 'stop', message: err.message || 'Your account cannot record attendance. Contact HR.' };
  if (code === 'duplicate_scan') return { next: 'retry', message: 'Another scan for you was being recorded at the same moment. Check your history, then try again if it is not there.' };
  if (code === 'rate_limited' || status === 429) {
    const m = minutes(err?.details?.retryAfterSeconds);
    return { next: 'retry', message: `Too many attempts. Try again in ${m} minute${m === 1 ? '' : 's'}.` };
  }
  if (status === 413 || code === 'too_large' || code === 'bad_photo' || (status === 400 && err?.fields?.photo)) {
    return { next: 'retake', message: 'The photo could not be accepted. Take it again.' };
  }
  if (status === 502 || status === 503) return { next: 'retry', message: 'Photo storage is not available right now. Your attendance was not recorded. Try again in a moment.' };
  return { next: 'retry', message: 'Something went wrong and your attendance may not have been recorded. Try again, or check your history.' };
}

// History row from GET /attendance/mine (company-timezone HH:MM or null).
export function historyRow(item) {
  return {
    id: item.id,
    date: formatWorkDate(item.workDate),
    checkIn: item.checkInTime ?? '—',
    checkOut: item.checkOutTime ?? '—',
    status: statusText(item.status, item.lateMinutes),
    tone: statusTone(item.status),
    corrected: Boolean(item.corrected),
  };
}

// 'data:image/jpeg;base64,AAAA' -> 'AAAA'. The scan endpoint wants raw base64, no prefix.
export const stripDataUrl = (s) => String(s ?? '').replace(/^data:[^;,]*;base64,/, '');
