import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { noStore } from '../middleware/noStore.js';
import { validate, v } from '../middleware/validate.js';
import { hasPermission } from '../services/permissions.js';
import { config } from '../config.js';
import { attendanceListQuery, ATTENDANCE_STATUSES } from '../services/hrSchemas.js';
import { attendancePdf } from '../services/attendancePdf.js';
import { attendanceWorkbook } from '../services/attendanceWorkbook.js';
import { pageSchema } from '../services/sql.js';
import { companyDate } from '../services/attendance.js';
import { readAttendanceRecords } from './attendanceRecords.js';

const reports = new Map([
  ['daily-attendance', {
    title: 'Daily attendance register',
    group: 'Attendance',
    permission: 'attendance.read',
    exports: { xlsx: attendanceWorkbook, pdf: attendancePdf },
    filters: [
      { key: 'date', label: 'Attendance date', type: 'date', required: true },
      { key: 'departmentId', label: 'Department', type: 'select', placeholder: 'All departments', lookup: 'departments' },
      { key: 'employeeId', label: 'Employee', type: 'select', placeholder: 'All employees', lookup: 'employees' },
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
]);

function metadata(id, { title, group, exports, filters, columns }) {
  return { id, title, group, formats: Object.keys(exports), filters, columns };
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
};

for (const [id, report] of reports) {
  router.get(`/${id}/preview`, requirePermission(report.permission), validate(report.schema, 'query'),
    wrap(async (req, res) => {
      const result = await report.preview(req.user, req.query);
      // Return only the report columns and the row identifier.
      const items = result.items.map(row => ({
        id: row.id,
        ...Object.fromEntries(report.columns.map(({ key }) => [key, row[key]])),
      }));
      res.json({ ...result, items });
    }));
  for (const [format, render] of Object.entries(report.exports)) {
    router.get(`/${id}/export.${format}`, requirePermission(report.permission), validate(report.schema, 'query'),
      wrap(async (req, res) => {
        const result = await report.preview(req.user, { ...req.query, page: 1, pageSize: MAX_EXPORT_ROWS + 1 });
        if (result.total > MAX_EXPORT_ROWS || result.items.length > MAX_EXPORT_ROWS) {
          throw new HttpError(422, 'This report exceeds 5,000 rows. Narrow the filters and try again.', 'export_limit');
        }
        const buffer = await render({
          title: report.title, company: config.company.name, date: req.query.date,
          columns: report.columns, rows: result.items,
        });
        res.attachment(`${id}-${req.query.date}.${format}`);
        res.type(contentTypes[format]).send(Buffer.from(buffer));
      }));
  }
}

export default router;
