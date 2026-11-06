import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { noStore } from '../middleware/noStore.js';
import { validate, v } from '../middleware/validate.js';
import { hasPermission } from '../services/permissions.js';
import { config } from '../config.js';
import { attendanceListQuery, ATTENDANCE_STATUSES } from '../services/hrSchemas.js';
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
]);

function reportColumns(report, filters) {
  if (filters.groupBy === 'department') {
    return report.columns.filter(column => column.key !== 'employeeCode' && column.key !== 'fullName');
  }
  return report.columns;
}

function metadata(id, { title, group, description, exports, filters, columns }) {
  return { id, title, group, description, formats: Object.keys(exports), filters, columns };
}

const router = Router();
router.use(noStore, requireAuth);

router.get('/', (req, res) => {
  const items = [...reports]
    .filter(([, report]) => hasPermission(req.user, report.permission))
    .map(([id, report]) => metadata(id, report));
  res.json({ items, today: companyDate() });
});

const MAX_EXPORT_ROWS = 5000;
const contentTypes = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

for (const [id, report] of reports) {
  router.get(`/${id}/preview`, requirePermission(report.permission), validate(report.schema, 'query'),
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
    router.get(`/${id}/export.${format}`, requirePermission(report.permission), validate(report.schema, 'query'),
      wrap(async (req, res) => {
        const result = await report.preview(req.user, { ...req.query, page: 1, pageSize: MAX_EXPORT_ROWS + 1 });
        if (result.total > MAX_EXPORT_ROWS || result.items.length > MAX_EXPORT_ROWS) {
          throw new HttpError(422, 'This report exceeds 5,000 rows. Narrow the filters and try again.', 'export_limit');
        }
        const buffer = await render({
          title: report.title, company: config.company.name, date: req.query.date, month: req.query.month,
          columns: reportColumns(report, req.query), rows: result.items,
        });
        res.attachment(`${id}-${req.query.date ?? req.query.month}.${format}`);
        res.type(contentTypes[format]).send(Buffer.from(buffer));
      }));
  }
}

export default router;
