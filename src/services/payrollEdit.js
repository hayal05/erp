import { loadAttendanceDeductions, isAttendanceItem } from './payrollAttendance.js';
import { parse, v } from '../middleware/validate.js';
import { HttpError } from '../middleware/error.js';
import { MAX_MINOR } from './money.js';
import { computeEntry, PayrollError } from './payrollEngine.js';
import { ENTRY_FIELDS, toEntry } from './payrollDraft.js';
import { toSalaryProfile } from './salaryProfiles.js';
import { audit, diffFields } from './audit.js';

export function parseEntryEdit(body) {
  const result = parse({ basicMinor: v.int({ min: 0, max: MAX_MINOR }), allowanceMinor: v.int({ min: 0, max: MAX_MINOR }) }, body);
  if (result.errors) return result;
  if (!Object.keys(result.value).length) return { errors: { _: 'Send basicMinor or allowanceMinor' } };
  return result;
}
const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
// Only this period's amounts change. Salary profiles and the flat deductions already allocated to this entry stay intact.
// Current tax/pension settings and allowance/pension applicability flags are used; approval will freeze them in task 4.13.
export async function editDraftEntry(db, { periodId, entryId, changes, actorId, settings, brackets, otherTaxes }) {
  const { rows: [period] } = await db.query("SELECT status, to_char(period_month, 'YYYY-MM') AS month FROM payroll_periods WHERE id=$1 FOR UPDATE", [periodId]);
  if (!period) throw new HttpError(404, 'Payroll period not found', 'not_found');
  if (period.status !== 'draft') throw new HttpError(409, 'Approved or paid payroll cannot be recalculated', 'conflict');
  const { rows: [row] } = await db.query('SELECT * FROM payroll_entries WHERE id=$1 AND period_id=$2 FOR UPDATE', [entryId, periodId]);
  if (!row) throw new HttpError(404, 'Payroll entry not found', 'not_found');
  const before = toEntry(row);
  const { rows: [profileRow] } = await db.query('SELECT * FROM salary_profiles WHERE employee_id=$1', [before.employeeId]);
  if (!profileRow) throw new HttpError(422, 'Salary profile is missing', 'missing_profiles');
  // Preserve allocated manual deductions; replace computed attendance lines from current attendance.
  const { rows: flat } = await db.query("SELECT * FROM payroll_entry_items WHERE entry_id=$1 AND kind <> 'other_tax' ORDER BY id", [entryId]);
  const deductions = flat.map((r) => ({ kind: r.kind, label: r.label, amountMinor: Number(r.amount_minor), sourceId: r.source_id == null ? null : Number(r.source_id) }));
  const attendance = await loadAttendanceDeductions(db, { employeeId: before.employeeId, month: period.month, basicMinor: changes.basicMinor ?? before.basicMinor, settings });
  const effectiveDeductions = [...deductions.filter((i) => !isAttendanceItem(i)), ...attendance];
  let computed;
  try {
    computed = computeEntry({ settings, brackets, otherTaxes, profile: { ...toSalaryProfile(profileRow), basicMinor: changes.basicMinor ?? before.basicMinor, allowanceMinor: changes.allowanceMinor ?? before.allowanceMinor }, deductions: effectiveDeductions });
  } catch (err) {
    if (err instanceof PayrollError) throw new HttpError(422, err.message, err.code);
    throw err;
  }
  const diff = diffFields(before, computed, ENTRY_FIELDS);
  // Keep all derived columns in the same UPDATE so the database's formula constraints always hold.
  const { rows: [saved] } = await db.query(`UPDATE payroll_entries SET ${ENTRY_FIELDS.map((k, i) => `${snake(k)}=$${i + 2}`).join(', ')} WHERE id=$1 RETURNING *`,
    [entryId, ...ENTRY_FIELDS.map((k) => computed[k])]);
  // Replace computed tax/attendance lines. Manual deductions and one-time allocation are untouched.
  await db.query("DELETE FROM payroll_entry_items WHERE entry_id=$1 AND kind IN ('other_tax','absence','unpaid_leave')", [entryId]);
  for (const item of computed.items.filter((i) => i.kind === 'other_tax' || isAttendanceItem(i))) {
    await db.query('INSERT INTO payroll_entry_items (entry_id,kind,label,rate,base_minor,amount_minor,source_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [entryId, item.kind, item.label, item.rate, item.baseMinor, item.amountMinor, item.sourceId]);
  }
  await audit(db, { actorId, action: 'payroll.entry.recalculate', entityType: 'payroll_entry', entityId: entryId, details: { periodId, employeeId: before.employeeId, changes: diff } });
  return toEntry(saved);
}
