import { HttpError } from '../middleware/error.js';
import { loadPayrollDetail } from './payrollDetails.js';
import { config } from '../config.js';
// Ownership and release state are checked together in SQL; request-supplied employee IDs are never used.
export async function listOwnPayslips(db,{ userId, page, pageSize }) {
  const where="FROM payroll_entries pe JOIN payroll_periods p ON p.id=pe.period_id JOIN employees e ON e.id=pe.employee_id WHERE e.user_id=$1 AND p.status IN ('approved','paid')";
  const {rows}=await db.query(`SELECT pe.id, to_char(p.period_month,'YYYY-MM') AS month, p.status, pe.net_minor,
    p.config_snapshot->'settings'->>'currencyCode' AS currency_code ${where} ORDER BY p.period_month DESC, pe.id DESC LIMIT $2 OFFSET $3`,[userId,pageSize,(page-1)*pageSize]);
  const {rows:[count]}=await db.query(`SELECT count(*)::int AS total ${where}`,[userId]);
  return {items:rows.map(r=>({id:Number(r.id),month:r.month,status:r.status,netMinor:Number(r.net_minor),currencyCode:r.currency_code??'ETB'})),total:count.total,page,pageSize};
}
export async function loadOwnPayslip(db,{userId,entryId}) {
  const {rows:[owned]}=await db.query(`SELECT pe.period_id,p.approved_at,to_char(p.paid_on,'YYYY-MM-DD') AS paid_on
    FROM payroll_entries pe JOIN payroll_periods p ON p.id=pe.period_id JOIN employees e ON e.id=pe.employee_id
    WHERE pe.id=$1 AND e.user_id=$2 AND p.status IN ('approved','paid')`,[entryId,userId]);
  if(!owned)throw new HttpError(404,'Payslip not found','not_found');
  const detail=await loadPayrollDetail(db,{periodId:Number(owned.period_id),entryId});
  // Never return config_snapshot: it contains every employee's salary, not just this one.
  return {...detail,companyName:config.company.name,approvedAt:owned.approved_at,paidOn:owned.paid_on};
}
