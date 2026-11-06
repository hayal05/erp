import { query, withTransaction } from '../db/pool.js';
import { readEmployeeDirectory, readEmployeeProfile } from '../routes/employees.js';
import { scopeSql } from './accessScope.js';
import { loadRetirement } from './retirement.js';
import { pageOffset, pageResult } from './sql.js';

export { readEmployeeDirectory };

export async function employeeReportLookups(user) {
  const args = [];
  const scope = scopeSql(user, 'employees.read', 'e', args);
  const { rows: employees } = await query(`
    SELECT e.id, e.employee_code AS "employeeCode", u.full_name AS "fullName",
      e.department_id AS "departmentId", d.name AS "departmentName"
    FROM employees e JOIN users u ON u.id=e.user_id
    LEFT JOIN departments d ON d.id=e.department_id
    WHERE ${scope} ORDER BY lower(u.full_name), e.id
  `, args);
  const departments = [...new Map(employees.filter(row => row.departmentId != null)
    .map(row => [row.departmentId, { id: Number(row.departmentId), name: row.departmentName }])).values()];
  departments.sort((a, b) => a.name.localeCompare(b.name));
  return { departments, employees: employees.map(row => ({ ...row, id: Number(row.id) })) };
}

export async function readDepartmentHeadcount(user, filters) {
  const args = [filters.departmentId ?? null, filters.status ?? null];
  const scope = scopeSql(user, 'employees.read', 'e', args);
  const { rows: [result] } = await query(`
    WITH counts AS (
      SELECT e.department_id AS id, COALESCE(d.name, 'Unassigned') AS "departmentName",
        count(*) FILTER (WHERE e.status='active')::int AS active,
        count(*) FILTER (WHERE e.status='inactive')::int AS inactive,
        count(*)::int AS total
      FROM employees e LEFT JOIN departments d ON d.id=e.department_id
      WHERE ${scope} AND ($1::bigint IS NULL OR e.department_id=$1)
        AND ($2::text IS NULL OR e.status=$2)
      GROUP BY e.department_id, d.name
    ), selected AS (
      SELECT * FROM counts ORDER BY "departmentName", id
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}
    )
    SELECT (SELECT count(*)::int FROM counts) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY "departmentName", id) FROM selected), '[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  return pageResult(result.items.map(row => ({ ...row, id: row.id ?? 'unassigned' })), filters, result.total);
}

export async function readProfileReport(user, filters) {
  const profile = await readEmployeeProfile(user, filters.employeeId, { page: 1, pageSize: 1 });
  const fields = [
    ['Employee ID', profile.employeeCode], ['Name', profile.fullName],
    ['Department', profile.departmentName], ['Position', profile.positionName ?? profile.jobTitle],
    ['Employment type', profile.employmentType], ['Status', profile.status],
    ['Start date', profile.startDate], ['Date of birth', profile.dateOfBirth],
    ['Gender', profile.gender], ['Field of study', profile.fieldOfStudy],
    ['Email', profile.email], ['Phone', profile.phone], ['Shift', profile.shiftName],
  ];
  const experience = profile.experienceSummary?.replace(/\s+/g, ' ').trim();
  const paragraphs = experience?.match(/.{1,280}(?:\s|$)|.{1,280}/gu) ?? [];
  paragraphs.forEach((value, index) => fields.push([index ? '' : 'Experience', value.trim()]));
  const items = fields.map(([label, value], id) => ({ id, label, value }));
  const offset = pageOffset(filters);
  return pageResult(items.slice(offset, offset + filters.pageSize), filters, items.length);
}

export async function readPositionHistoryReport(user, filters) {
  const profile = await readEmployeeProfile(user, filters.employeeId, filters);
  return { ...profile.positionHistory, items: profile.positionHistory.items.map(row => ({
    ...row, employeeCode: profile.employeeCode, fullName: profile.fullName,
    entryType: row.baseline ? 'Initial record' : 'Position change',
  })) };
}

export function readRetirementReport(user, filters) {
  return withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return loadRetirement(db, filters, { user });
  });
}
