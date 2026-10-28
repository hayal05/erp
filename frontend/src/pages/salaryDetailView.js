export const DEDUCTION_LABELS = { advance: 'Salary advance', loan: 'Loan repayment', penalty: 'Penalty', other: 'Other deduction', absence: 'Absence', unpaid_leave: 'Unpaid leave' };
export function detailBreakdown({ entry, items }) {
  const taxes = items.filter((i) => i.kind === 'other_tax');
  const deductions = items.filter((i) => i.kind !== 'other_tax');
  const taxTotal = taxes.reduce((s,i) => s+i.amountMinor,0), deductionTotal = deductions.reduce((s,i) => s+i.amountMinor,0);
  const totalEmployeeDeductions = entry.incomeTaxMinor + entry.otherTaxMinor + entry.employeePensionMinor + entry.otherDeductionsMinor;
  return { taxes, deductions, taxTotal, deductionTotal, totalEmployeeDeductions,
    matches: taxTotal === entry.otherTaxMinor && deductionTotal === entry.otherDeductionsMinor && entry.netMinor === entry.grossMinor - totalEmployeeDeductions && entry.employerCostMinor === entry.grossMinor + entry.employerPensionMinor };
}
