import { query, withTransaction } from '../db/pool.js';
import { v } from '../middleware/validate.js';
import { pageSchema, pageOffset, pageResult } from './sql.js';
import { readCompanyCosts } from './companyCosts.js';
import { readEmployerCostDetails } from './payrollReportData.js';
import { LIABILITY_CTE, toBalance, PAYMENT_COLUMNS, toPayment } from './settlements.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';

const month = { key: 'month', label: 'Payroll month', type: 'month', required: true };
const schema = { ...pageSchema, month: v.string({ required: true, pattern: /^[1-9]\d{3}-(0[1-9]|1[0-2])$/, patternMessage: 'Use YYYY-MM' }) };
const base = { group: 'Payroll', filters: [month], schema, exports: { xlsx: attendanceWorkbook, pdf: attendancePdf } };
const cost = { ...base, permission: 'company_costs.read' };
const settlement = { ...base, group: 'Settlements', permission: 'settlements.read', companyWide: true };
const money = (key, header) => ({ key, header, width: 15, type: 'money' });
const currency = { key: 'currency', header: 'Currency', width: 10 };
const paidOn = { key: 'paidOn', header: 'Payroll paid on', width: 16 };
const costColumns = [
  money('gross', 'Gross pay'), money('salaryPaid', 'Net pay disbursed'),
  money('companyPension', 'Employer pension'), money('employerCost', 'Employer cost'),
];
const kinds = [{ value: 'income_tax', label: 'Income tax' }, { value: 'pension', label: 'Pension' }];

function majorUnits(result, columns) {
  const amounts = columns.filter(column => column.type === 'money');
  return { ...result, items: result.items.map(row => ({
    ...row, ...Object.fromEntries(amounts.map(({ key }) => [key, row[`${key}Minor`] / 100])),
  })) };
}

async function readSettlementBalances(_user, filters) {
  const { rows } = await query(`${LIABILITY_CTE}
    SELECT *, to_char(period_month,'YYYY-MM') AS month, to_char(paid_on,'YYYY-MM-DD') AS paid_on
    FROM balances WHERE period_month=$1::date`, [`${filters.month}-01`]);
  const offset = pageOffset(filters);
  return pageResult(rows.slice(offset, offset + filters.pageSize).map(toBalance), filters, rows.length);
}

async function readSettlementPayments(_user, filters) {
  return withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const args = [`${filters.month}-01`, filters.kind ?? null];
    const from = `FROM payroll_settlements s JOIN payroll_periods p ON p.id=s.period_id
      LEFT JOIN users u ON u.id=s.recorded_by_user_id
      WHERE p.status='paid' AND p.period_month=$1::date AND ($2::text IS NULL OR s.kind=$2)`;
    const { rows: [count] } = await db.query(`SELECT count(*)::int AS total ${from}`, args);
    const { rows } = await db.query(`SELECT ${PAYMENT_COLUMNS}, p.config_snapshot->'settings'->>'currencyCode' AS currency
      ${from} ORDER BY s.payment_date DESC, s.id DESC LIMIT $3 OFFSET $4`, [...args, filters.pageSize, pageOffset(filters)]);
    return pageResult(rows.map(row => ({
      ...toPayment(row), currency: row.currency, kind: kinds.find(kind => kind.value === row.kind)?.label,
    })), filters, count.total);
  });
}

const balances = [
  paidOn, currency, money('incomeTax', 'Tax due'), money('incomeTaxSettled', 'Tax settled'),
  money('incomeTaxBalance', 'Tax outstanding'), money('employeePension', 'Employee pension'),
  money('companyPension', 'Employer pension'), money('pension', 'Pension due'),
  money('pensionSettled', 'Pension settled'), money('pensionBalance', 'Pension outstanding'),
];
const payments = [
  { key: 'paymentDate', header: 'Payment date', width: 16 },
  { key: 'kind', header: 'Liability', width: 14 }, currency, money('amount', 'Amount'),
  { key: 'reference', header: 'Reference', width: 24 },
  { key: 'recordedBy', header: 'Recorded by', width: 22 },
  { key: 'notes', header: 'Notes', width: 30 },
];

export const financeReports = [
  ['employer-cost-summary', {
    ...cost, title: 'Employer cost summary',
    columns: [paidOn, currency, { key: 'employeeCount', header: 'Employees', width: 12 }, ...costColumns],
    preview: async (user, filters) => majorUnits(await readCompanyCosts(user, filters), costColumns),
  }],
  ['employer-cost-detail', {
    ...cost, title: 'Employer cost by employee', lookupPath: '/reports/company-cost-lookups',
    filters: [month, { key: 'departmentId', label: 'Department', type: 'select', placeholder: 'All departments', lookup: 'departments' },
      { key: 'employeeId', label: 'Employee', type: 'select', placeholder: 'All employees', lookup: 'employees' }],
    schema: { ...schema, departmentId: v.int({ min: 1 }), employeeId: v.int({ min: 1 }) },
    columns: [{ key: 'employeeCode', header: 'Employee ID', width: 17 },
      { key: 'fullName', header: 'Employee', width: 26 }, { key: 'departmentName', header: 'Department', width: 20 }, currency, ...costColumns],
    preview: readEmployerCostDetails,
  }],
  ['settlement-balances', {
    ...settlement, title: 'Tax and pension settlement balances', columns: balances,
    preview: async (user, filters) => majorUnits(await readSettlementBalances(user, filters), balances),
  }],
  ['settlement-payments', {
    ...settlement, title: 'Settlement payment history',
    filters: [month, { key: 'kind', label: 'Liability', type: 'select', placeholder: 'All liabilities', options: kinds }],
    schema: { ...schema, kind: v.enum({ values: kinds.map(kind => kind.value) }) },
    columns: payments,
    preview: async (user, filters) => majorUnits(await readSettlementPayments(user, filters), payments),
  }],
];
