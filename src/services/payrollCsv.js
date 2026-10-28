import { HttpError } from '../middleware/error.js';
import { toEntry } from './payrollDraft.js';
import { formatMoney } from './money.js';
export const CSV_COLUMNS = Object.freeze([
  ['employeeCode','Employee ID'],['employeeName','Employee Name'],['basicMinor','Basic Salary'],['allowanceMinor','Allowance'],
  ['incomeTaxMinor','Income Tax'],['otherTaxMinor','Other Tax'],['employeePensionMinor','Pension'],['otherDeductionsMinor','Other Deductions'],['netMinor','Net Salary'],
]);
// Quoted CSV text, with formula-like employee data neutralized for spreadsheet applications.
export function csvText(value) {
  let text=String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(text)) text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export function payrollCsv(entries) {
  const rows=[CSV_COLUMNS.map(([,label])=>csvText(label)).join(',')];
  for(const e of entries) rows.push(CSV_COLUMNS.map(([key],i)=>i<2?csvText(e[key]):formatMoney(e[key]).replaceAll(',','')).join(','));
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
// Export every saved row, in sheet order, regardless of the UI's current pagination. No recalculation or source-data reads.
export async function loadPayrollCsv(db, periodId) {
  const {rows:[period]}=await db.query("SELECT to_char(period_month,'YYYY-MM') AS month FROM payroll_periods WHERE id=$1",[periodId]);
  if(!period) throw new HttpError(404,'Payroll period not found','not_found');
  const {rows}=await db.query('SELECT * FROM payroll_entries WHERE period_id=$1 ORDER BY employee_id',[periodId]);
  return {filename:`payroll-${period.month}.csv`, csv:payrollCsv(rows.map(toEntry))};
}
