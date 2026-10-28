import { divRound, MAX_MINOR } from './money.js';
import { config } from '../config.js';
import { parse, v } from '../middleware/validate.js';
export const ATTENDANCE_KEYS = ['absenceDeductionEnabled', 'unpaidLeaveDeductionEnabled'];
export function parseAttendancePolicy(body) {
  const result = parse({ absenceDeductionEnabled: v.boolean(), unpaidLeaveDeductionEnabled: v.boolean() }, body);
  if (result.errors) return result;
  if (!Object.keys(result.value).length) return { errors: { _: 'Send at least one deduction switch' } };
  return result;
}
export const attendancePolicy = (r) => ({ absenceDeductionEnabled: r.absence_deduction_enabled, unpaidLeaveDeductionEnabled: r.unpaid_leave_deduction_enabled });
export function attendanceAmounts({ basicMinor, workingDays, absentDays, unpaidDays, settings }) {
  if (![basicMinor, workingDays, absentDays, unpaidDays].every(Number.isSafeInteger) || basicMinor < 0 || basicMinor > MAX_MINOR || workingDays < 0 || absentDays < 0 || unpaidDays < 0 || absentDays + unpaidDays > workingDays) throw new Error('Invalid attendance deduction inputs');
  const a = settings.absenceDeductionEnabled ? absentDays : 0, u = settings.unpaidLeaveDeductionEnabled ? unpaidDays : 0;
  if (!workingDays || !basicMinor || !a && !u) return [];
  const total = Number(divRound(BigInt(basicMinor) * BigInt(a + u), BigInt(workingDays), settings.roundingMode));
  const unpaid = Number(divRound(BigInt(basicMinor) * BigInt(u), BigInt(workingDays), settings.roundingMode));
  // Round the combined deduction once; allocate unpaid leave first and the remainder to absence (never over-deduct basic).
  return [{ kind: 'absence', days: a, amountMinor: total - unpaid, label: 'Absence' }, { kind: 'unpaid_leave', days: u, amountMinor: unpaid, label: 'Unpaid leave' }]
    .filter((i) => i.amountMinor > 0).map((i) => ({ kind: i.kind, label: `${i.label} (${i.days}/${workingDays} working days; basic salary)`, amountMinor: i.amountMinor, sourceId: null }));
}
// No attendance mutations or 62-day lookback limit. Derive each date directly from schedule, leave and any HR-corrected record.
export async function loadAttendanceDeductions(db, { employeeId, month, basicMinor, settings }) {
  if (!settings.absenceDeductionEnabled && !settings.unpaidLeaveDeductionEnabled) return [];
  const start = `${month.slice(0, 7)}-01`;
  const { rows: [counts] } = await db.query(`WITH days AS (
    SELECT g.d::date AS d, e.start_date, s.end_time,
      a.status, a.check_in_at,
      l.is_paid, l.id AS leave_id,
      (now() AT TIME ZONE $3)::date AS today, (now() AT TIME ZONE $3)::time AS clock
    FROM employees e JOIN shifts s ON s.id=e.shift_id
    CROSS JOIN generate_series($2::date, ($2::date + interval '1 month - 1 day')::date, interval '1 day') g(d)
    LEFT JOIN attendance_records a ON a.employee_id=e.id AND a.work_date=g.d::date
    LEFT JOIN LATERAL (SELECT lr.id, lt.is_paid FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
      WHERE lr.employee_id=e.id AND lr.status='approved' AND g.d::date BETWEEN lr.start_date AND lr.end_date LIMIT 1) l ON true
    WHERE e.id=$1 AND EXTRACT(ISODOW FROM g.d)::int=ANY(s.work_days)
      AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.holiday_date=g.d::date))
    SELECT count(*)::int AS working_days,
      count(*) FILTER (WHERE d>=start_date AND check_in_at IS NULL AND leave_id IS NOT NULL AND NOT is_paid
        AND (status IS NULL OR status IN ('absent','on_leave')))::int AS unpaid_days,
      count(*) FILTER (WHERE d>=start_date AND check_in_at IS NULL AND leave_id IS NULL
        AND (status IS NULL OR status='absent') AND (d<today OR (d=today AND clock>end_time)))::int AS absent_days
    FROM days`, [employeeId, start, config.company.timezone]);
  return attendanceAmounts({ basicMinor, workingDays: counts.working_days, absentDays: counts.absent_days, unpaidDays: counts.unpaid_days, settings });
}
export const isAttendanceItem = (i) => i.kind === 'absence' || i.kind === 'unpaid_leave';
