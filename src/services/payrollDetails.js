import { HttpError } from '../middleware/error.js';
import { toEntry } from './payrollDraft.js';
import { snapshotItem } from './payrollWorkflow.js';
// Read stored entry amounts and stored item lines from one consistent snapshot; never consult live settings or deductions.
export async function loadPayrollDetail(db, { periodId, entryId }) {
  const { rows: [row] } = await db.query(`SELECT e.*, p.status AS period_status, to_char(p.period_month,'YYYY-MM') AS month,
    p.config_snapshot->'settings'->>'currencyCode' AS currency_code
    FROM payroll_entries e JOIN payroll_periods p ON p.id=e.period_id WHERE e.id=$1 AND e.period_id=$2`, [entryId, periodId]);
  if (!row) throw new HttpError(404, 'Payroll entry not found', 'not_found');
  const { rows } = await db.query('SELECT * FROM payroll_entry_items WHERE entry_id=$1 ORDER BY id', [entryId]);
  return { period: { id: periodId, month: row.month, status: row.period_status, currencyCode: row.currency_code ?? 'ETB' }, entry: toEntry(row), items: rows.map((r) => ({ id: Number(r.id), ...snapshotItem(r) })) };
}
