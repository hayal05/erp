import { query, withTransaction } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { scopeSql } from './accessScope.js';
import { loadPayrollDetail } from './payrollDetails.js';
import { pageOffset, pageResult } from './sql.js';

const currency = `COALESCE(p.config_snapshot->'settings'->>'currencyCode',
  CASE WHEN p.status='draft' THEN (SELECT currency_code FROM payroll_settings) END, 'ETB')`;
const identity = `pe.employee_code AS "employeeCode", pe.employee_name AS "fullName",
  d.name AS "departmentName", ${currency} AS currency, p.status`;

function payrollSelection(user, filters, permission = 'payroll.read') {
  const args = [`${filters.month}-01`, filters.departmentId ?? null, filters.employeeId ?? null];
  const scope = scopeSql(user, permission, 'e', args);
  return {
    args,
    from: `FROM payroll_entries pe JOIN payroll_periods p ON p.id=pe.period_id
      JOIN employees e ON e.id=pe.employee_id LEFT JOIN departments d ON d.id=e.department_id`,
    where: `p.period_month=$1::date AND ($2::bigint IS NULL OR e.department_id=$2)
      AND ($3::bigint IS NULL OR e.id=$3) AND ${scope}`,
  };
}

async function readPage(sql, args, filters) {
  const order = '"fullName", "employeeCode", id';
  const { rows: [result] } = await query(`
    WITH report_rows AS (${sql}), selected AS (
      SELECT * FROM report_rows ORDER BY ${order}
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}
    )
    SELECT (SELECT count(*)::int FROM report_rows) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY ${order}) FROM selected), '[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  return pageResult(result.items, filters, result.total);
}

export function readPayrollRegister(user, filters) {
  const { args, from, where } = payrollSelection(user, filters);
  return readPage(`
    SELECT pe.id, ${identity},
      pe.basic_minor / 100.0 AS basic, pe.allowance_minor / 100.0 AS allowance,
      pe.gross_minor / 100.0 AS gross, pe.income_tax_minor / 100.0 AS "incomeTax",
      pe.other_tax_minor / 100.0 AS "otherTax", pe.employee_pension_minor / 100.0 AS pension,
      pe.other_deductions_minor / 100.0 AS "otherDeductions", pe.net_minor / 100.0 AS net
    ${from} WHERE ${where}
  `, args, filters);
}

export function readPayrollDeductions(user, filters) {
  const { args, from, where } = payrollSelection(user, filters);
  return readPage(`
    SELECT pe.id::text || ':' || line.key AS id, ${identity}, line.kind, line.label,
      line.amount_minor / 100.0 AS amount
    ${from}
    CROSS JOIN LATERAL (
      SELECT 'tax' AS key, 'income_tax' AS kind, 'Income tax' AS label, pe.income_tax_minor AS amount_minor
      UNION ALL
      SELECT 'pension', 'employee_pension', 'Employee pension', pe.employee_pension_minor
      UNION ALL
      SELECT 'item-' || i.id::text, i.kind, i.label, i.amount_minor
      FROM payroll_entry_items i WHERE i.entry_id=pe.id
    ) line
    WHERE ${where} AND line.amount_minor <> 0
  `, args, filters);
}

export function readEmployeePayslipReport(user, filters) {
  return withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { args, from, where } = payrollSelection(user, filters);
    const { rows: [saved] } = await db.query(`
      SELECT pe.id, pe.period_id, to_char(p.paid_on, 'YYYY-MM-DD') AS "paidOn"
      ${from} WHERE ${where} AND p.status IN ('approved', 'paid')
    `, args);
    if (!saved) throw new HttpError(404, 'No approved or paid payslip found for this employee and month.', 'not_found');

    const { entry, period, items } = await loadPayrollDetail(db, {
      periodId: Number(saved.period_id), entryId: Number(saved.id),
    });
    const money = minor => `${(minor / 100).toFixed(2)} ${period.currencyCode}`;
    const fields = [
      ['Employee ID', entry.employeeCode], ['Employee', entry.employeeName],
      ['Payroll status', period.status], ['Paid on', saved.paidOn],
      ['Basic pay', money(entry.basicMinor)], ['Allowance', money(entry.allowanceMinor)],
      ['Gross pay', money(entry.grossMinor)], ['Income tax', money(entry.incomeTaxMinor)],
      ['Other taxes', money(entry.otherTaxMinor)], ['Employee pension', money(entry.employeePensionMinor)],
      ['Other deductions', money(entry.otherDeductionsMinor)],
      ...items.map(item => [`Breakdown · ${item.label}`, money(item.amountMinor)]),
      ['Net pay', money(entry.netMinor)],
    ];
    const rows = fields.map(([label, value], id) => ({ id, label, value }));
    const offset = pageOffset(filters);
    return pageResult(rows.slice(offset, offset + filters.pageSize), filters, rows.length);
  });
}

export function readEmployerCostDetails(user, filters) {
  const { args, from, where } = payrollSelection(user, filters, 'company_costs.read');
  return readPage(`
    SELECT pe.id, ${identity}, pe.gross_minor / 100.0 AS gross,
      pe.net_minor / 100.0 AS "salaryPaid", pe.employer_pension_minor / 100.0 AS "companyPension",
      pe.employer_cost_minor / 100.0 AS "employerCost"
    ${from} WHERE ${where} AND p.status='paid'
  `, args, filters);
}
