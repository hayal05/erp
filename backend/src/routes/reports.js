import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { noStore } from '../middleware/noStore.js';
import { validate, v } from '../middleware/validate.js';
import { hasPermission } from '../services/permissions.js';
import { pageSchema } from '../services/sql.js';
import { companyDate } from '../services/attendance.js';
import { readAttendanceRecords } from './attendanceRecords.js';

const reports = new Map([
  ['daily-attendance', {
    title: 'Daily attendance register',
    group: 'Attendance',
    permission: 'attendance.read',
    formats: [],
    filters: [{ key: 'date', label: 'Attendance date', type: 'date', required: true }],
    schema: { ...pageSchema, date: v.date({ required: true }) },
    columns: [
      { key: 'employeeCode', header: 'Employee ID' },
      { key: 'fullName', header: 'Employee' },
      { key: 'departmentName', header: 'Department' },
      { key: 'checkInTime', header: 'Check in' },
      { key: 'checkOutTime', header: 'Check out' },
      { key: 'status', header: 'Status' },
    ],
    preview: (user, { date, page, pageSize }) =>
      readAttendanceRecords(user, { from: date, to: date, page, pageSize }),
  }],
]);

function metadata(id, { title, group, formats, filters, columns }) {
  return { id, title, group, formats, filters, columns };
}

const router = Router();
router.use(noStore, requireAuth);

router.get('/', (req, res) => {
  const items = [...reports]
    .filter(([, report]) => hasPermission(req.user, report.permission))
    .map(([id, report]) => metadata(id, report));
  res.json({ items, today: companyDate() });
});

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
}

export default router;
