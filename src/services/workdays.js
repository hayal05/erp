// Working-day calculator (spec 10, task 3.2): how many leave days a date range costs for one employee.
// A day counts when its ISO weekday is one of the employee's shift work days AND it is not a company holiday.
// Dates are plain calendar dates ('YYYY-MM-DD'): no time zones are involved, so the result is the same for every
// server and browser. Whole days only (MVP decision, migration 003). Pure functions first; one DB wrapper at the bottom.

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_RANGE_DAYS = 366; // a request lives inside one calendar year (DB CHECK), so this is a safety cap, not a rule

// 'YYYY-MM-DD' -> whole days since 1970-01-01 (UTC). Rejects impossible dates such as 2026-02-30 instead of rolling over.
export function dayNumber(ymd) {
  const m = YMD.exec(String(ymd));
  if (!m) throw new Error('Date must be YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error(`${ymd} is not a real date`);
  return ms / 86_400_000;
}
export const formatDay = (n) => new Date(n * 86_400_000).toISOString().slice(0, 10);

// ISO weekday of a day number: 1 = Monday ... 7 = Sunday (same numbering as shifts.work_days).
const weekdayOf = (n) => { const dow = new Date(n * 86_400_000).getUTCDay(); return dow === 0 ? 7 : dow; };

const toDaySet = (workDays) => {
  const set = new Set((Array.isArray(workDays) ? workDays : []).map(Number));
  for (const d of set) if (!Number.isInteger(d) || d < 1 || d > 7) throw new Error('Work days must be ISO weekdays 1-7');
  return set;
};

export function isWorkingDay(ymd, workDays, holidays = []) {
  const days = toDaySet(workDays);
  return days.has(weekdayOf(dayNumber(ymd))) && !new Set(holidays).has(ymd);
}

// { days, dates } for start..end inclusive. `holidays` is any iterable of 'YYYY-MM-DD' (extra ones outside the range are ignored;
// a holiday that falls on a non-work day is simply not double-counted). days = 0 is a valid answer (e.g. a weekend only):
// the caller decides that such a request is refused.
export function workingDaysBetween({ start, end, workDays, holidays = [] }) {
  const from = dayNumber(start), to = dayNumber(end);
  if (to < from) throw new Error('End date must be on or after the start date');
  if (to - from + 1 > MAX_RANGE_DAYS) throw new Error(`A range is limited to ${MAX_RANGE_DAYS} days`);
  const days = toDaySet(workDays);
  const off = new Set([...holidays].map(dayNumber));
  const dates = [];
  for (let n = from; n <= to; n += 1) if (days.has(weekdayOf(n)) && !off.has(n)) dates.push(formatDay(n));
  return { days: dates.length, dates };
}

// For one employee: their shift's work days (the employee's own schedule) and the holidays inside the range, from the database.
// Two light queries; `db` is anything with query(sql, params) (the pool or a transaction client).
export async function workingDaysForEmployee(db, { employeeId, start, end }) {
  dayNumber(start); dayNumber(end); // fail on bad dates before touching the database
  const { rows: [shift] } = await db.query(
    `SELECT s.id, s.work_days FROM employees e JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1`, [employeeId]);
  if (!shift) throw new Error('employee has no shift');
  const { rows } = await db.query(
    `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d FROM holidays WHERE holiday_date BETWEEN $1 AND $2`, [start, end]);
  return { ...workingDaysBetween({ start, end, workDays: shift.work_days, holidays: rows.map((r) => r.d) }), shiftId: Number(shift.id) };
}
