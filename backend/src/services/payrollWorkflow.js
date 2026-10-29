import { loadAttendanceDeductions, isAttendanceItem } from './payrollAttendance.js';
import { HttpError } from '../middleware/error.js';
import { computeEntry, PayrollError, validateBrackets } from './payrollEngine.js';
import { ENTRY_FIELDS, toEntry } from './payrollDraft.js';
import { toSalaryProfile } from './salaryProfiles.js';
import { audit } from './audit.js';
export const snapshotItem = (r) => ({ kind: r.kind, label: r.label, rate: r.rate == null ? null : Number(r.rate), baseMinor: r.base_minor == null ? null : Number(r.base_minor), amountMinor: Number(r.amount_minor), sourceId: r.source_id == null ? null : Number(r.source_id) });
const canonicalItems = (items) => items.map((i) => JSON.stringify({ kind: i.kind, label: i.label, rate: i.rate ?? null, baseMinor: i.baseMinor ?? null, amountMinor: i.amountMinor, sourceId: i.sourceId ?? null })).sort();
export function assertEntryCurrent(entry, items, computed) {
  const stale = ENTRY_FIELDS.some((k) => entry[k] !== computed[k]) || JSON.stringify(canonicalItems(items)) !== JSON.stringify(canonicalItems(computed.items));
  if (stale) throw new HttpError(409, 'Payroll inputs changed. Ask HR to regenerate or recalculate this draft and review its totals before approving.', 'stale_payroll', { entryId: entry.id });
}
// The caller supplies one repeatable-read transaction and configuration loaded under the settings lock.
// Approval never changes reviewed amounts: stale entries must be recalculated explicitly before retrying.
export async function approvePeriod(db, { periodId, actorId, settings, brackets, otherTaxes }) {
  const { rows: [period] } = await db.query("SELECT *, to_char(period_month, 'YYYY-MM') AS month FROM payroll_periods WHERE id=$1 FOR UPDATE", [periodId]);
  if (!period) throw new HttpError(404, 'Payroll period not found', 'not_found');
  if (period.status !== 'draft') throw new HttpError(409, 'Only a draft payroll can be approved', 'conflict');
  const problems = validateBrackets(brackets);
  if (problems.length) throw new HttpError(422, problems.join('; '), 'invalid_brackets');
  const { rows } = await db.query('SELECT * FROM payroll_entries WHERE period_id=$1 ORDER BY employee_id FOR UPDATE', [periodId]);
  if (!rows.length) throw new HttpError(422, 'An empty payroll cannot be approved', 'no_entries');
  const snapshots = [];
  for (const row of rows) {
    const entry = toEntry(row);
    const { rows: [profileRow] } = await db.query('SELECT * FROM salary_profiles WHERE employee_id=$1', [entry.employeeId]);
    if (!profileRow) throw new HttpError(422, 'Salary profile is missing', 'missing_profiles', { employeeId: entry.employeeId });
    const profile = { ...toSalaryProfile(profileRow), basicMinor: entry.basicMinor, allowanceMinor: entry.allowanceMinor };
    const { rows: itemRows } = await db.query('SELECT * FROM payroll_entry_items WHERE entry_id=$1 ORDER BY id', [entry.id]);
    const items = itemRows.map(snapshotItem);
    const attendance = await loadAttendanceDeductions(db, { employeeId: entry.employeeId, month: period.month, basicMinor: entry.basicMinor, settings });
    const deductions = [...items.filter((i) => i.kind !== 'other_tax' && !isAttendanceItem(i)), ...attendance];
    let computed;
    try { computed = computeEntry({ settings, brackets, otherTaxes, profile, deductions }); }
    catch (err) { if (err instanceof PayrollError) throw new HttpError(422, err.message, err.code); throw err; }
    assertEntryCurrent(entry, items, computed);
    snapshots.push({ ...entry, profile: { basicMinor: profile.basicMinor, allowanceMinor: profile.allowanceMinor, allowanceTaxable: profile.allowanceTaxable, allowancePensionable: profile.allowancePensionable, pensionApplies: profile.pensionApplies }, items });
  }
  const { rows: [extra] } = await db.query('SELECT currency_code, absence_deduction_enabled, unpaid_leave_deduction_enabled FROM payroll_settings');
  const snapshot = { version: 1, month: period.month, settings: { ...settings, attendanceDeductionRule: 'basic_over_scheduled_working_days_v1', currencyCode: extra.currency_code, absenceDeductionEnabled: extra.absence_deduction_enabled, unpaidLeaveDeductionEnabled: extra.unpaid_leave_deduction_enabled }, brackets, otherTaxes, entries: snapshots };
  const { rows: [approved] } = await db.query("UPDATE payroll_periods SET status='approved', config_snapshot=$2::jsonb, approved_at=now(), approved_by_user_id=$3 WHERE id=$1 RETURNING approved_at, approved_by_user_id", [periodId, JSON.stringify(snapshot), actorId]);
  await audit(db, { actorId, action: 'payroll.period.approve', entityType: 'payroll_period', entityId: periodId, details: { month: period.month, employeeCount: rows.length, from: 'draft', to: 'approved' } });
  return { id: periodId, month: period.month, status: 'approved', approvedAt: approved.approved_at, approvedByUserId: Number(approved.approved_by_user_id) };
}

// Record a payment made outside the application. The approved snapshot and entry amounts are never recalculated here.
export async function markPeriodPaid(db, { periodId, actorId, paidOn }) {
  const { rows: [period] } = await db.query("SELECT *, to_char(period_month, 'YYYY-MM') AS month FROM payroll_periods WHERE id=$1 FOR UPDATE", [periodId]);
  if (!period) throw new HttpError(404, 'Payroll period not found', 'not_found');
  if (period.status !== 'approved') throw new HttpError(409, 'Only an approved payroll can be marked paid', 'conflict');
  await db.query("UPDATE payroll_periods SET status='paid', paid_on=$2::date, paid_by_user_id=$3 WHERE id=$1", [periodId, paidOn, actorId]);
  await audit(db, { actorId, action: 'payroll.period.pay', entityType: 'payroll_period', entityId: periodId, details: { month: period.month, from: 'approved', to: 'paid', paidOn } });
  return { id: periodId, month: period.month, status: 'paid', paidOn, paidByUserId: actorId };
}
