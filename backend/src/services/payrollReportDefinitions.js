import { v } from '../middleware/validate.js';
import { pageSchema } from './sql.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';
import { readPayrollRegister, readEmployeePayslipReport, readPayrollDeductions } from './payrollReportData.js';

const base = { group: 'Payroll', permission: 'payroll.read', lookupPath: '/reports/payroll-lookups' };
const month = { key: 'month', label: 'Payroll month', type: 'month', required: true };
const employee = { key: 'employeeId', label: 'Employee', type: 'select', placeholder: 'All employees', lookup: 'employees' };
const filters = [month,
  { key: 'departmentId', label: 'Department', type: 'select', placeholder: 'All departments', lookup: 'departments' },
  employee,
];
const schema = {
  ...pageSchema,
  month: v.string({ required: true, pattern: /^[1-9]\d{3}-(0[1-9]|1[0-2])$/, patternMessage: 'Use YYYY-MM' }),
  departmentId: v.int({ min: 1 }),
  employeeId: v.int({ min: 1 }),
};
const identity = [
  { key: 'employeeCode', header: 'Employee ID', width: 17 },
  { key: 'fullName', header: 'Employee', width: 26 },
  { key: 'departmentName', header: 'Department', width: 20 },
  { key: 'currency', header: 'Currency', width: 10 },
  { key: 'status', header: 'Period status', width: 14 },
];
const money = (key, header) => ({ key, header, width: 14, type: 'money' });
const exports = { xlsx: attendanceWorkbook, pdf: attendancePdf };

export const payrollReports = [
  ['payroll-register', {
    ...base, title: 'Payroll register', exports, filters, schema,
    description: 'Uses saved amounts and employee names. Department filters use current assignments.',
    columns: [...identity, money('basic', 'Basic pay'), money('allowance', 'Allowance'),
      money('gross', 'Gross pay'), money('incomeTax', 'Income tax'), money('otherTax', 'Other taxes'),
      money('pension', 'Employee pension'), money('otherDeductions', 'Other deductions'), money('net', 'Net pay')],
    preview: readPayrollRegister,
  }],
  ['employee-payslip', {
    ...base, title: 'Employee payslip', layout: 'portrait', exports: { pdf: attendancePdf },
    filters: [month, { ...employee, required: true, placeholder: 'Choose an employee' }],
    schema: { ...schema, employeeId: v.int({ required: true, min: 1 }) },
    columns: [{ key: 'label', header: 'Field', width: 38 }, { key: 'value', header: 'Value', width: 62 }],
    preview: readEmployeePayslipReport,
  }],
  ['payroll-deductions', {
    ...base, title: 'Payroll deductions', exports, filters, schema,
    description: 'Uses the saved income tax, employee pension and deduction lines for the selected payroll month.',
    columns: [...identity, { key: 'kind', header: 'Type', width: 18 },
      { key: 'label', header: 'Deduction', width: 28 }, money('amount', 'Amount')],
    preview: readPayrollDeductions,
  }],
];
