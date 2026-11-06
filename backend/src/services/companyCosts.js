import { withTransaction } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { scopeSql } from './accessScope.js';
import { pageOffset, pageResult } from './sql.js';

const amount = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new HttpError(500, 'Company cost total exceeds the supported amount range', 'amount_range');
  return n;
};
// Read saved paid entries only, never current profiles/settings or recalculated values.
export function readCompanyCosts(user, filters) {
  return withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const args = [];
    const month = filters.month ? 'AND p.period_month=$1::date' : '';
    if (filters.month) args.push(`${filters.month}-01`);
    const scope = scopeSql(user, 'company_costs.read', 'se', args);
    const from=`FROM payroll_periods p LEFT JOIN payroll_entries e ON e.period_id=p.id LEFT JOIN employees se ON se.id=e.employee_id WHERE p.status='paid' AND ${scope} ${month}`;
    const { rows } = await db.query(`SELECT p.id, to_char(p.period_month,'YYYY-MM') AS month,
      to_char(p.paid_on,'YYYY-MM-DD') AS paid_on, p.config_snapshot->'settings'->>'currencyCode' AS currency,
      count(e.id)::int AS employee_count, COALESCE(sum(e.net_minor),0) AS salary_paid,
      COALESCE(sum(e.gross_minor),0) AS gross_salary, COALESCE(sum(e.employer_pension_minor),0) AS company_pension,
      COALESCE(sum(e.employer_cost_minor),0) AS employer_cost
      ${from}
      GROUP BY p.id ORDER BY p.period_month DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`, [...args,filters.pageSize, pageOffset(filters)]);
    const { rows: [count] } = await db.query(`SELECT count(DISTINCT p.id)::int AS total ${from}`,args);
    return pageResult(rows.map(r => ({ id: Number(r.id), month: r.month, paidOn: r.paid_on, currency: r.currency,
      employeeCount: r.employee_count, salaryPaidMinor: amount(r.salary_paid), grossMinor: amount(r.gross_salary),
      companyPensionMinor: amount(r.company_pension), employerCostMinor: amount(r.employer_cost) })), filters, count.total);
  });
}
