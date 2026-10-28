// Deduction items for the payroll engine (spec 16), task 4.8b: the row mappers, loadDeductions (4.8b-2) and
// consumeOneTimeDeductions (4.8b-3). The caller passes the database client (`db.query`, a pool or a transaction client), so the
// mappers stay pure and the loaders can be tested with a fake client. The only import is HttpError (config only, no pg/express).
import { HttpError } from '../middleware/error.js';

// Database row -> the API shape of an item (what routes/deductions.js returns).
export const toDeduction = (r) => ({
  id: Number(r.id), employeeId: Number(r.employee_id), kind: r.kind, name: r.name, amountMinor: Number(r.amount_minor),
  recurring: r.recurring, enabled: r.enabled, appliedPeriodId: r.applied_period_id == null ? null : Number(r.applied_period_id),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

// API item -> the entry payrollEngine.computeEntry reads in `deductions`: { kind, label, amountMinor, sourceId }.
// `name` becomes `label` and `id` becomes `sourceId`; nothing else is passed on, so the engine never sees flags or dates.
export const toEngineDeduction = (item) => ({ kind: item.kind, label: item.name, amountMinor: item.amountMinor, sourceId: item.id });

// The deductions to apply to ONE employee's next payroll, already in the shape computeEntry reads, oldest item first.
// Enabled items only. A recurring item always applies; a one-time item applies only while applied_period_id is null (it has not
// been used by a payroll yet). `lock: true` adds FOR UPDATE: call it inside the generation transaction (4.11, 4.15) so two
// generations running at once cannot both pick the same one-time item; the second waits, then sees it consumed.
export const loadDeductions = async (db, employeeId, { lock = false } = {}) => {
  const { rows } = await db.query(
    `SELECT * FROM deduction_items WHERE employee_id = $1 AND enabled AND (recurring OR applied_period_id IS NULL) ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [employeeId]);
  return rows.map((r) => toEngineDeduction(toDeduction(r)));
};

// Marks one-time items as used by a payroll period: sets applied_period_id on exactly the given ids. Call it inside the
// generation transaction (4.11, 4.15) with the sourceIds of the one-time items loadDeductions(..., {lock: true}) returned.
// Only rows that are NOT recurring and not yet consumed are touched. If the number of updated rows differs from ids.length (an id
// that is recurring, already consumed, unknown, or listed twice: i.e. a race or a caller bug) it throws 409 `conflict`, so the
// surrounding transaction rolls back and the period never records a deduction that was applied elsewhere. Empty list: no query.
const isId = (n) => Number.isSafeInteger(n) && n > 0;
export const consumeOneTimeDeductions = async (db, periodId, ids) => {
  if (!isId(periodId)) throw new HttpError(500, 'Invalid payroll period', 'server_error');
  if (!Array.isArray(ids)) throw new HttpError(500, 'Invalid deduction list', 'server_error');
  if (ids.length === 0) return 0;
  if (!ids.every(isId)) throw new HttpError(500, 'Invalid deduction id', 'server_error');
  const { rowCount } = await db.query(
    `UPDATE deduction_items SET applied_period_id = $1 WHERE id = ANY($2::bigint[]) AND NOT recurring AND applied_period_id IS NULL`,
    [periodId, ids]);
  if (rowCount !== ids.length) {
    throw new HttpError(409, 'A one-time deduction was already used or is no longer available. Generate the payroll again.', 'conflict');
  }
  return rowCount;
};

// Refuses to change or delete an item a payroll has already used (applied_period_id set), so history stays intact. Takes the API
// shape (toDeduction). Call it inside the FOR UPDATE section of PATCH (4.8b-4) and DELETE (4.8b-5), before anything else is
// decided, so even a no-op PATCH is refused. 409 `conflict`; if the period was a draft that is later deleted, the item is freed.
export const assertNotConsumed = (item) => {
  if (item.appliedPeriodId != null) {
    throw new HttpError(409, 'This deduction was already used in a payroll and can no longer be changed or deleted. Add a new item instead.', 'conflict');
  }
};
