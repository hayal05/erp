import { v } from '../middleware/validate.js';
import { readLeaveRequests } from '../routes/leaveAdmin.js';
import { leaveHrListQuery, LEAVE_STATUSES } from './hrSchemas.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';
import { attendanceWord } from './attendanceWord.js';
import { readLeaveBalancesReport, readLeaveUsageReport } from './leaveReportData.js';

const base = { group: 'Leave', permission: 'leave.read', lookupPath: '/reports/leave-lookups' };
const filters = [
  { key: 'year', label: 'Leave year', type: 'number', min: 2000, max: 2100, required: true },
  { key: 'departmentId', label: 'Department', type: 'select', placeholder: 'All departments', lookup: 'departments' },
  { key: 'employeeId', label: 'Employee', type: 'select', placeholder: 'All employees', lookup: 'employees' },
];
const { status, ...baseSchema } = leaveHrListQuery;
const schema = { ...baseSchema, year: v.int({ min: 2000, max: 2100, required: true }) };
const identity = [
  { key: 'employeeCode', header: 'Employee ID', width: 16 },
  { key: 'fullName', header: 'Employee', width: 24 },
  { key: 'departmentName', header: 'Department', width: 21 },
  { key: 'leaveTypeName', header: 'Leave type', width: 20 },
];
const usage = [
  { key: 'used', header: 'Approved days' },
  { key: 'pending', header: 'Pending days' },
];
const exports = { xlsx: attendanceWorkbook, pdf: attendancePdf };

export const leaveReports = [
  ['leave-requests', {
    ...base, title: 'Leave requests and decisions', exports,
    filters: [...filters, { key: 'status', label: 'Status', type: 'select', placeholder: 'All statuses',
      options: LEAVE_STATUSES.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) }],
    schema: { ...schema, status },
    columns: [...identity,
      { key: 'startDate', header: 'Start date', type: 'date' },
      { key: 'endDate', header: 'End date', type: 'date' },
      { key: 'days', header: 'Days', width: 9 },
      { key: 'status', header: 'Status' },
      { key: 'decidedBy', header: 'Decided by', width: 20 },
      { key: 'decisionTime', header: 'Decision time (UTC)', width: 21 },
      { key: 'decisionRemarks', header: 'Decision remarks', width: 29 },
    ],
    preview: async (user, query) => {
      const result = await readLeaveRequests(user, query);
      return { ...result, items: result.items.map(row => ({
        ...row, fullName: row.employeeName,
        decisionTime: row.decidedAt ? new Date(row.decidedAt).toISOString().slice(0, 16).replace('T', ' ') : null,
      })) };
    },
  }],
  ['leave-balances', {
    ...base, title: 'Leave balances', exports, filters, schema,
    description: 'Remaining days subtract approved and pending leave from the adjusted entitlement.',
    columns: [...identity,
      { key: 'entitled', header: 'Entitled days' },
      { key: 'adjusted', header: 'Adjustment' },
      { key: 'total', header: 'Adjusted entitlement' },
      ...usage, { key: 'remaining', header: 'Remaining days' },
    ],
    preview: readLeaveBalancesReport,
  }],
  ['leave-usage', {
    ...base, title: 'Leave usage summary', exports: { ...exports, docx: attendanceWord },
    filters: [...filters, { key: 'groupBy', label: 'Group by', type: 'select', default: 'employee',
      options: [{ value: 'employee', label: 'Employee' }, { value: 'department', label: 'Department' }] }],
    schema: { ...schema, groupBy: v.enum({ values: ['employee', 'department'], default: 'employee' }) },
    columns: [...identity, ...usage],
    preview: readLeaveUsageReport,
  }],
];
