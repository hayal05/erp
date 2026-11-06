import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { noStore } from '../middleware/noStore.js';
import { validate, v } from '../middleware/validate.js';
import { hasPermission } from '../services/permissions.js';
import { config } from '../config.js';
import { attendanceListQuery, ATTENDANCE_STATUSES } from '../services/hrSchemas.js';
import { employeeReports } from '../services/employeeReportDefinitions.js';
import { employeeReportLookups } from '../services/employeeReportData.js';
import { exceptionKinds, readAttendanceExceptions, readAttendanceCorrections } from '../services/attendanceReportDetails.js';
import { readMonthlyAttendance } from '../services/monthlyAttendance.js';
import { attendanceWord } from '../services/attendanceWord.js';
import { attendancePdf } from '../services/attendancePdf.js';
import { attendanceWorkbook } from '../services/attendanceWorkbook.js';
import { pageSchema } from '../services/sql.js';
import { companyDate } from '../services/attendance.js';
import { readAttendanceRecords } from './attendanceRecords.js';

const departmentFilter = { key: 'departmentId', label: 'Department', type: 'select', placeholder: 'All departments', lookup: 'departments' };
const employeeFilter = { key: 'employeeId', label: 'Employee', type: 'select', placeholder: 'All employees', lookup: 'employees' };
const monthlyCounts = [
  { key: 'present', header: 'Present' },
  { key: 'late', header: 'Late' },
  { key: 'absent', header: 'Absent' },
  { key: 'onLeave', header: 'On leave' },
  { key: 'incomplete', header: 'Incomplete' },
  { key: 'total', header: 'Total' },
];

const rangeFilters = [
  { key: 'from', label: 'From date', type: 'date', required: true },
  { key: 'to', label: 'To date', type: 'date', required: true },
  departmentFilter, employeeFilter,
];
const rangeSchema = {
  ...pageSchema,
  from: v.date({ required: true }),
  to: v.date({ required: true }),
  departmentId: attendanceListQuery.departmentId,
  employeeId: attendanceListQuery.employeeId,
};
const recordIdentity = [
  { key: 'workDate', header: 'Date', width: 15 },
  { key: 'employeeCode', header: 'Employee ID', width: 16 },
  { key: 'fullName', header: 'Employee', width: 27 },
  { key: 'departmentName', header: 'Department', width: 20 },
];
const exportDetails = { xlsx: attendanceWorkbook, pdf: attendancePdf };

function exceptionWord(data) {
  const rows = exceptionKinds.map(([key, label]) => ({
    label,
    count: data.rows.filter(row => row[key]).length,
  }));
  rows.push({ label: 'Unique attendance records', count: data.rows.length });
  return attendanceWord({
    ...data, rows, count: data.rows.length,
    columns: [{ key: 'label', header: 'Exception', width: 35 }, { key: 'count', header: 'Count' }],
    note: 'A record can have more than one exception, so category counts can overlap.',
  });
}

const reports = new Map([
  ['daily-attendance', {
    title: 'Daily attendance register',
    group: 'Attendance',
    permission: 'attendance.read',
    exports: { xlsx: attendanceWorkbook, pdf: attendancePdf },
    filters: [
      { key: 'date', label: 'Attendance date', type: 'date', required: true },
      departmentFilter, employeeFilter,
      { key: 'status', label: 'Status', type: 'select', placeholder: 'All statuses',
        options: ATTENDANCE_STATUSES.map(value => ({ value, label: value === 'on_leave' ? 'On leave' : value[0].toUpperCase() + value.slice(1) })) },
    ],
    schema: {
      ...pageSchema, date: v.date({ required: true }),
      departmentId: attendanceListQuery.departmentId,
      employeeId: attendanceListQuery.employeeId,
      status: attendanceListQuery.status,
    },
    columns: [
      { key: 'employeeCode', header: 'Employee ID' },
      { key: 'fullName', header: 'Employee' },
      { key: 'departmentName', header: 'Department' },
      { key: 'checkInTime', header: 'Check in' },
      { key: 'checkOutTime', header: 'Check out' },
      { key: 'status', header: 'Status' },
    ],
    preview: (user, { date, ...filters }) =>
      readAttendanceRecords(user, { ...filters, from: date, to: date }),
  }],
  ['monthly-attendance', {
    title: 'Monthly attendance summary',
    description: 'Counts use saved daily attendance records and current department assignments.',
    group: 'Attendance',
    permission: 'attendance.read',
    exports: { xlsx: attendanceWorkbook, pdf: attendancePdf, docx: attendanceWord },
    filters: [
      { key: 'month', label: 'Attendance month', type: 'month', required: true },
      { key: 'groupBy', label: 'Group by', type: 'select', default: 'employee',
        options: [{ value: 'employee', label: 'Employee' }, { value: 'department', label: 'Department' }] },
      departmentFilter, employeeFilter,
    ],
    schema: {
      ...pageSchema,
      month: v.string({ required: true, pattern: /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/, patternMessage: 'Use YYYY-MM' }),
      groupBy: v.enum({ values: ['employee', 'department'], default: 'employee' }),
      departmentId: attendanceListQuery.departmentId,
      employeeId: attendanceListQuery.employeeId,
    },
    columns: [
      { key: 'employeeCode', header: 'Employee ID', width: 18 },
      { key: 'fullName', header: 'Employee', width: 32 },
      { key: 'departmentName', header: 'Department', width: 28 },
      ...monthlyCounts,
    ],
    preview: readMonthlyAttendance,
  }],
  ['attendance-exceptions', {
    title: 'Attendance exceptions',
    description: 'Reviews late arrivals, absences and missing punches in saved attendance records.',
    group: 'Attendance',
    permission: 'attendance.read',
    exports: { ...exportDetails, docx: exceptionWord },
    filters: [...rangeFilters, { key: 'kind', label: 'Exception', type: 'select',
      placeholder: 'All exceptions', options: exceptionKinds.map(([value, label]) => ({ value, label })) }],
    schema: { ...rangeSchema, kind: v.enum({ values: exceptionKinds.map(([key]) => key) }) },
    columns: [...recordIdentity,
      { key: 'checkInTime', header: 'Check in', width: 12 },
      { key: 'checkOutTime', header: 'Check out', width: 12 },
      { key: 'lateMinutes', header: 'Late minutes', width: 14 },
      { key: 'exception', header: 'Exception', width: 28 },
    ],
    preview: readAttendanceExceptions,
  }],
  ['attendance-corrections', {
    title: 'Attendance correction history',
    description: 'Filters by attendance date. Approval details appear when an approval was recorded.',
    group: 'Attendance',
    permission: 'attendance.manage',
    additionalPermission: 'audit.hr',
    exports: exportDetails,
    filters: rangeFilters,
    schema: rangeSchema,
    columns: [...recordIdentity,
      { key: 'changes', header: 'Changes', width: 32 },
      { key: 'reason', header: 'Reason', width: 30 },
      { key: 'modified', header: 'Modified by and at', width: 26 },
      { key: 'approved', header: 'Approved by and at', width: 26 },
    ],
    preview: readAttendanceCorrections,
  }],
  ...employeeReports,
]);

function reportColumns(report, filters) {
  if (filters.groupBy === 'department') {
    return report.columns.filter(column => column.key !== 'employeeCode' && column.key !== 'fullName');
  }
  return report.columns;
}

function metadata(id, { title, group, description, lookupPath, exports, filters, columns }) {
  return { id, title, group, description, lookupPath, formats: Object.keys(exports), filters, columns };
}

const router = Router();
router.use(noStore, requireAuth);

router.get('/', (req, res) => {
  const items = [...reports]
    .filter(([, report]) => hasPermission(req.user, report.permission) &&
      (!report.additionalPermission || hasPermission(req.user, report.additionalPermission)))
    .map(([id, report]) => metadata(id, report));
  res.json({ items, today: companyDate() });
});

router.get('/employee-lookups', requirePermission('employees.read'), wrap(async (req, res) => {
  res.json(await employeeReportLookups(req.user));
}));

const MAX_EXPORT_ROWS = 5000;
const contentTypes = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

for (const [id, report] of reports) {
  const guards = [requirePermission(report.permission)];
  if (report.additionalPermission) guards.push(requirePermission(report.additionalPermission));
  router.get(`/${id}/preview`, ...guards, validate(report.schema, 'query'),
    wrap(async (req, res) => {
      const result = await report.preview(req.user, req.query);
      const columns = reportColumns(report, req.query);
      // Return only the report columns and the row identifier.
      const items = result.items.map(row => ({
        id: row.id,
        ...Object.fromEntries(columns.map(({ key }) => [key, row[key]])),
      }));
      res.json({ ...result, columns, items });
    }));
  for (const [format, render] of Object.entries(report.exports)) {
    router.get(`/${id}/export.${format}`, ...guards, validate(report.schema, 'query'),
      wrap(async (req, res) => {
        const result = await report.preview(req.user, { ...req.query, page: 1, pageSize: MAX_EXPORT_ROWS + 1 });
        if (result.total > MAX_EXPORT_ROWS || result.items.length > MAX_EXPORT_ROWS) {
          throw new HttpError(422, 'This report exceeds 5,000 rows. Narrow the filters and try again.', 'export_limit');
        }
        const { date, month, from, to } = req.query;
        const period = from ? `${from} to ${to}` : undefined;
        const asOf = date || month || period ? undefined : result.today ?? companyDate();
        const buffer = await render({
          title: report.title, company: config.company.name, date, month, period, asOf, group: report.group,
          columns: reportColumns(report, req.query), rows: result.items,
        });
        res.attachment(`${id}-${date ?? month ?? (from ? `${from}-to-${to}` : asOf)}.${format}`);
        res.type(contentTypes[format]).send(Buffer.from(buffer));
      }));
  }
}

export default router;
