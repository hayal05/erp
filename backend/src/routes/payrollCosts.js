import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { wrap, HttpError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { pageSchema, pageOffset, pageResult } from '../services/sql.js';
const router = Router();
router.use(noStore, requireHr);
const amount = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new HttpError(500, 'Company cost total exceeds the supported amount range', 'amount_range');
  return n;
};
// Read saved paid entries only, never current profiles/settings or recalculated values.
router.get('/', validate(pageSchema, 'query'), wrap(async (req, res) => {
  const result = await withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await db.query(`SELECT p.id, to_char(p.period_month,'YYYY-MM') AS month,
      to_char(p.paid_on,'YYYY-MM-DD') AS paid_on, p.config_snapshot->'settings'->>'currencyCode' AS currency,
      count(e.id)::int AS employee_count, COALESCE(sum(e.net_minor),0) AS salary_paid,
      COALESCE(sum(e.gross_minor),0) AS gross_salary, COALESCE(sum(e.employer_pension_minor),0) AS company_pension,
      COALESCE(sum(e.employer_cost_minor),0) AS employer_cost
      FROM payroll_periods p LEFT JOIN payroll_entries e ON e.period_id=p.id WHERE p.status='paid'
      GROUP BY p.id ORDER BY p.period_month DESC LIMIT $1 OFFSET $2`, [req.query.pageSize, pageOffset(req.query)]);
    const { rows: [count] } = await db.query("SELECT count(*)::int AS total FROM payroll_periods WHERE status='paid'");
    return pageResult(rows.map(r => ({ id: Number(r.id), month: r.month, paidOn: r.paid_on, currency: r.currency,
      employeeCount: r.employee_count, salaryPaidMinor: amount(r.salary_paid), grossMinor: amount(r.gross_salary),
      companyPensionMinor: amount(r.company_pension), employerCostMinor: amount(r.employer_cost) })), req.query, count.total);
  });
  res.json(result);
}));
export default router;
