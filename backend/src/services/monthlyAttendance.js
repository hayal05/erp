import { query } from '../db/pool.js';
import { scopeSql } from './accessScope.js';
import { pageOffset, pageResult } from './sql.js';

export async function readMonthlyAttendance(user, filters) {
  const { month, groupBy, departmentId, employeeId, pageSize } = filters;
  const args = [`${month}-01`, departmentId ?? null, employeeId ?? null];
  const scope = scopeSql(user, 'attendance.read', 'e', args);
  const byDepartment = groupBy === 'department';
  const identity = byDepartment
    ? 'e.department_id AS id, d.name AS "departmentName"'
    : 'e.id, e.employee_code AS "employeeCode", u.full_name AS "fullName", d.name AS "departmentName"';
  const group = byDepartment ? 'e.department_id, d.name' : 'e.id, u.full_name, d.name';
  const sort = byDepartment ? '"departmentName" NULLS LAST, id' : '"fullName", id';

  const { rows: [summary] } = await query(`
    WITH grouped AS (
      SELECT ${identity}, count(*)::int AS total,
        count(*) FILTER (WHERE a.status = 'present')::int AS present,
        count(*) FILTER (WHERE a.status = 'late')::int AS late,
        count(*) FILTER (WHERE a.status = 'absent')::int AS absent,
        count(*) FILTER (WHERE a.status = 'on_leave')::int AS "onLeave",
        count(*) FILTER (WHERE a.status = 'incomplete')::int AS incomplete
      FROM attendance_records a
      JOIN employees e ON e.id = a.employee_id
      JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE a.work_date >= $1::date AND a.work_date < $1::date + interval '1 month'
        AND ($2::bigint IS NULL OR e.department_id = $2)
        AND ($3::bigint IS NULL OR e.id = $3)
        AND ${scope}
      GROUP BY ${group}
    ), selected AS (
      SELECT * FROM grouped ORDER BY ${sort}
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}
    )
    SELECT (SELECT count(*)::int FROM grouped) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY ${sort}) FROM selected), '[]'::json) AS items
  `, [...args, pageSize, pageOffset(filters)]);

  const items = summary.items.map(row => ({
    ...row,
    id: row.id ?? 'unassigned',
    departmentName: row.departmentName ?? 'Unassigned',
  }));
  return pageResult(items, filters, summary.total);
}
