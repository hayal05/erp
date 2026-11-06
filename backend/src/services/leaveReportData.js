import { query } from '../db/pool.js';
import { scopeSql } from './accessScope.js';
import { shapeBalance } from './leave.js';
import { pageOffset, pageResult } from './sql.js';

function leaveFilters(user, filters) {
  const args = [filters.year, filters.departmentId ?? null, filters.employeeId ?? null];
  const scope = scopeSql(user, 'leave.read', 'e', args);
  return {
    args,
    where: `${scope} AND ($2::bigint IS NULL OR e.department_id=$2)
      AND ($3::bigint IS NULL OR e.id=$3)`,
  };
}

async function readPage(sql, args, filters) {
  const order = '"departmentName", "fullName", "leaveTypeName", id';
  const { rows: [result] } = await query(`
    WITH report_rows AS (${sql}), selected AS (
      SELECT * FROM report_rows ORDER BY ${order}
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}
    )
    SELECT (SELECT count(*)::int FROM report_rows) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY ${order}) FROM selected), '[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  return pageResult(result.items, filters, result.total);
}

const employeeJoins = `JOIN users u ON u.id=e.user_id
  LEFT JOIN departments d ON d.id=e.department_id`;
const yearRange = `r.start_date >= make_date($1::int, 1, 1)
  AND r.start_date < make_date($1::int + 1, 1, 1)`;
const dayTotals = `
  COALESCE(sum(r.days) FILTER (WHERE r.status='approved'), 0)::int AS used,
  COALESCE(sum(r.days) FILTER (WHERE r.status='pending'), 0)::int AS pending`;

export async function readLeaveBalancesReport(user, filters) {
  const { args, where } = leaveFilters(user, filters);
  const result = await readPage(`
    SELECT e.id::text || ':' || t.id::text AS id,
      e.employee_code AS "employeeCode", u.full_name AS "fullName",
      COALESCE(d.name, 'Unassigned') AS "departmentName", t.name AS "leaveTypeName",
      t.id AS type_id, t.code, t.name, t.is_paid, t.has_balance,
      COALESCE(b.entitled_days, t.default_days) AS entitled,
      COALESCE(b.adjusted_days, 0) AS adjusted, ${dayTotals}
    FROM employees e ${employeeJoins}
    CROSS JOIN leave_types t
    LEFT JOIN leave_balances b ON b.employee_id=e.id AND b.leave_type_id=t.id AND b.year=$1
    LEFT JOIN leave_requests r ON r.employee_id=e.id AND r.leave_type_id=t.id AND ${yearRange}
    WHERE ${where}
    GROUP BY e.id, u.full_name, d.name, t.id, b.id
  `, args, filters);
  return { ...result, items: result.items.map(row => {
    const balance = shapeBalance({ ...row, id: row.type_id });
    return {
      ...row, ...balance,
      entitled: balance.hasBalance ? balance.entitled : null,
      adjusted: balance.hasBalance ? balance.adjusted : null,
      total: balance.hasBalance ? balance.total : null,
    };
  }) };
}

export function readLeaveUsageReport(user, filters) {
  const { args, where } = leaveFilters(user, filters);
  const byDepartment = filters.groupBy === 'department';
  const id = byDepartment ? "COALESCE(e.department_id::text, 'unassigned')" : 'e.id::text';
  const person = byDepartment ? 'NULL::text AS "fullName"' : 'e.employee_code AS "employeeCode", u.full_name AS "fullName"';
  const grouping = byDepartment ? 'e.department_id' : 'e.id, u.full_name, e.department_id';
  return readPage(`
    SELECT ${id} || ':' || t.id::text AS id, ${person},
      COALESCE(d.name, 'Unassigned') AS "departmentName", t.name AS "leaveTypeName",
      ${dayTotals}
    FROM leave_requests r JOIN leave_types t ON t.id=r.leave_type_id
    JOIN employees e ON e.id=r.employee_id ${employeeJoins}
    WHERE ${where} AND ${yearRange} AND r.status IN ('approved','pending')
    GROUP BY ${grouping}, d.name, t.id
  `, args, filters);
}
