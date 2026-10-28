// Pure helpers for the HR Settings page (task 3.7): holidays and working schedules (shifts). Dates are plain
// 'YYYY-MM-DD' strings and times 'HH:MM' strings from the server; nothing here uses the browser's time zone.

export const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const SHORT = Object.fromEntries(WEEKDAYS);

// [1,2,3,4,5] -> 'Mon–Fri'; [1,2,3,6] -> 'Mon–Wed, Sat'; [2,4] -> 'Tue, Thu'. Runs of three or more days are shortened.
export function formatWorkDays(days) {
  const d = [...new Set(days ?? [])].filter((n) => SHORT[n]).sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < d.length;) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j += 1;
    if (j - i >= 2) parts.push(`${SHORT[d[i]]}–${SHORT[d[j]]}`);
    else for (let k = i; k <= j; k += 1) parts.push(SHORT[d[k]]);
    i = j + 1;
  }
  return parts.join(', ') || 'No work days';
}

export const toggleDay = (days, day) => (days.includes(day) ? days.filter((n) => n !== day) : [...days, day].sort((a, b) => a - b));

// ---- Holidays
export const EMPTY_HOLIDAY = { date: '', name: '' };
export const holidayForm = (h) => ({ date: h.date, name: h.name });

export function validateHoliday(f) {
  const e = {};
  if (!f.date) e.date = 'Choose a date';
  else if (f.date < '2000-01-01' || f.date > '2100-12-31') e.date = 'Choose a date between 2000 and 2100';
  if (!f.name.trim()) e.name = 'Give the holiday a name';
  else if (f.name.trim().length > 100) e.name = 'At most 100 characters';
  return e;
}
export const buildHoliday = (f) => ({ date: f.date, name: f.name.trim() });
export const holidayChanged = (f, h) => f.date !== h.date || f.name.trim() !== h.name;

// ---- Working schedules (shifts). Same-day shifts only in the MVP: the end must be after the start.
export const EMPTY_SHIFT = { name: '', startTime: '09:00', endTime: '17:00', graceMinutes: '0', workDays: [1, 2, 3, 4, 5] };
export const shiftForm = (s) => ({ name: s.name, startTime: s.startTime, endTime: s.endTime, graceMinutes: String(s.graceMinutes), workDays: [...s.workDays] });

export function validateShift(f) {
  const e = {};
  if (!f.name.trim()) e.name = 'Give the schedule a name';
  else if (f.name.trim().length > 100) e.name = 'At most 100 characters';
  if (!f.startTime) e.startTime = 'Choose a start time';
  if (!f.endTime) e.endTime = 'Choose an end time';
  else if (f.startTime && f.endTime <= f.startTime) e.endTime = 'Must be after the start time (shifts cannot run past midnight yet)';
  const g = String(f.graceMinutes).trim();
  if (!/^\d+$/.test(g) || Number(g) > 240) e.graceMinutes = 'Whole minutes from 0 to 240';
  if (!f.workDays.length) e.workDays = 'Choose at least one work day';
  return e;
}
export const buildShift = (f) => ({ name: f.name.trim(), startTime: f.startTime, endTime: f.endTime, graceMinutes: Number(String(f.graceMinutes).trim()),
  workDays: [...f.workDays].sort((a, b) => a - b) });
export function shiftChanged(f, s) {
  const b = buildShift(f);
  return b.name !== s.name || b.startTime !== s.startTime || b.endTime !== s.endTime || b.graceMinutes !== s.graceMinutes
    || JSON.stringify(b.workDays) !== JSON.stringify([...s.workDays].sort((x, y) => x - y));
}

export const shiftRow = (s) => ({ id: s.id, name: s.name, hours: `${s.startTime}–${s.endTime}`, grace: s.graceMinutes ? `${s.graceMinutes} min` : 'None',
  days: formatWorkDays(s.workDays), count: s.employeeCount });

// A failed save -> { fields, message }. Field messages sit under the inputs; `message` is for the top of the dialog.
export function saveErrorView(err) {
  const fields = err?.fields ?? {};
  if (Object.keys(fields).length) return { fields, message: '' };
  if (err?.status === 0 || err?.code === 'network') return { fields: {}, message: 'Cannot reach the server. Nothing was saved. Check your connection and try again.' };
  return { fields: {}, message: err?.message || 'Something went wrong. Nothing was saved.' };
}
