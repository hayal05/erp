import { HttpError } from '../middleware/error.js';
// Each aggregate is calculated separately to avoid multiplying employee amounts by payment count.
export const LIABILITY_CTE = `WITH liabilities AS (
  SELECT p.id, p.period_month, p.paid_on, p.config_snapshot->'settings'->>'currencyCode' AS currency,
    count(e.id)::int AS employee_count, COALESCE(sum(e.income_tax_minor),0) AS tax_due,
    COALESCE(sum(e.employee_pension_minor),0) AS employee_pension,
    COALESCE(sum(e.employer_pension_minor),0) AS employer_pension
  FROM payroll_periods p LEFT JOIN payroll_entries e ON e.period_id=p.id WHERE p.status='paid' GROUP BY p.id
), payments AS (
  SELECT period_id, COALESCE(sum(amount_minor) FILTER(WHERE kind='income_tax'),0) AS tax_settled,
    COALESCE(sum(amount_minor) FILTER(WHERE kind='pension'),0) AS pension_settled
  FROM payroll_settlements GROUP BY period_id
), balances AS (
  SELECT l.*, COALESCE(s.tax_settled,0) AS tax_settled, COALESCE(s.pension_settled,0) AS pension_settled,
    l.tax_due-COALESCE(s.tax_settled,0) AS tax_balance,
    l.employee_pension+l.employer_pension-COALESCE(s.pension_settled,0) AS pension_balance
  FROM liabilities l LEFT JOIN payments s ON s.period_id=l.id
)`;
export function safeAmount(value) {
  const n=Number(value);
  if(!Number.isSafeInteger(n)) throw new HttpError(500,'Settlement total exceeds the supported amount range','amount_range');
  return n;
}
export const toBalance = r => ({ id:Number(r.id),month:r.month,paidOn:r.paid_on,currency:r.currency,employeeCount:r.employee_count,
  incomeTaxMinor:safeAmount(r.tax_due),incomeTaxSettledMinor:safeAmount(r.tax_settled),incomeTaxBalanceMinor:safeAmount(r.tax_balance),
  employeePensionMinor:safeAmount(r.employee_pension),companyPensionMinor:safeAmount(r.employer_pension),
  pensionMinor:safeAmount(BigInt(r.employee_pension)+BigInt(r.employer_pension)),pensionSettledMinor:safeAmount(r.pension_settled),pensionBalanceMinor:safeAmount(r.pension_balance) });
export const PAYMENT_COLUMNS = `s.id,s.period_id,s.kind,s.amount_minor,to_char(s.payment_date,'YYYY-MM-DD') AS payment_date,
  s.reference,s.notes,s.recorded_at,u.full_name AS recorded_by`;
export const toPayment = r => ({id:Number(r.id),periodId:Number(r.period_id),kind:r.kind,amountMinor:safeAmount(r.amount_minor),
  paymentDate:r.payment_date,reference:r.reference,notes:r.notes,recordedAt:r.recorded_at,recordedBy:r.recorded_by});
export async function paidPeriod(db,id,{lock=false}={}) {
  const {rows:[r]}=await db.query(`SELECT id,status FROM payroll_periods WHERE id=$1${lock?' FOR UPDATE':''}`,[id]);
  if(!r)throw new HttpError(404,'Payroll period not found','not_found');
  if(r.status!=='paid')throw new HttpError(409,'Only payrolls marked Paid have settlement payables','conflict');
  return r;
}
