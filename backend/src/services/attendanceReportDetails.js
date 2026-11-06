import { query } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';
import { scopeSql } from './accessScope.js';
import { pageOffset, pageResult } from './sql.js';

export const exceptionKinds = [
  ['late', 'Late arrival'],
  ['absent', 'Absence'],
  ['missingIn', 'Missing check-in'],
  ['missingOut', 'Missing check-out'],
];

function attendanceFilters(user, filters, permissions) {
  const { from, to, departmentId, employeeId } = filters;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days < 0 || days >= 366) {
    throw new HttpError(400, 'Choose a date range of up to 366 days, with the end on or after the start.', 'validation');
  }
  const args = [from, to, departmentId ?? null, employeeId ?? null, config.company.timezone];
  const scope = permissions.map(permission => scopeSql(user, permission, 'e', args)).join(' AND ');
  return { args, where: `a.work_date BETWEEN $1::date AND $2::date
    AND ($3::bigint IS NULL OR e.department_id = $3)
    AND ($4::bigint IS NULL OR e.id = $4) AND ${scope}` };
}

async function readPage(sql, args, filters, order) {
  const { rows: [result] } = await query(`
    WITH records AS (${sql}),
    selected AS (
      SELECT * FROM records ORDER BY ${order}
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}
    )
    SELECT (SELECT count(*)::int FROM records) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY ${order}) FROM selected), '[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  return pageResult(result.items, filters, result.total);
}

const identity = `to_char(a.work_date, 'YYYY-MM-DD') AS "workDate",
  e.employee_code AS "employeeCode", u.full_name AS "fullName", d.name AS "departmentName"`;
const employees = `JOIN employees e ON e.id = a.employee_id
  JOIN users u ON u.id = e.user_id LEFT JOIN departments d ON d.id = e.department_id`;

export async function readAttendanceExceptions(user, filters) {
  const { args, where } = attendanceFilters(user, filters, ['attendance.read']);
  args.push(filters.kind ?? null);
  const kind = args.length;
  const result = await readPage(`
    SELECT * FROM (
      SELECT a.id, ${identity},
        to_char(a.check_in_at AT TIME ZONE $5::text, 'HH24:MI') AS "checkInTime",
        to_char(a.check_out_at AT TIME ZONE $5::text, 'HH24:MI') AS "checkOutTime",
        a.late_minutes AS "lateMinutes",
        a.status = 'late' AS late, a.status = 'absent' AS absent,
        a.status = 'incomplete' AND a.check_in_at IS NULL AS "missingIn",
        a.check_out_at IS NULL AND (
          a.status = 'incomplete' OR (a.check_in_at IS NOT NULL AND
            (a.work_date < (now() AT TIME ZONE $5::text)::date OR
             (a.work_date = (now() AT TIME ZONE $5::text)::date AND
              (now() AT TIME ZONE $5::text)::time > s.end_time)))
        ) AS "missingOut"
      FROM attendance_records a ${employees}
      JOIN shifts s ON s.id = e.shift_id
      WHERE ${where}
    ) daily
    WHERE CASE $${kind}::text
      WHEN 'late' THEN late WHEN 'absent' THEN absent
      WHEN 'missingIn' THEN "missingIn" WHEN 'missingOut' THEN "missingOut"
      ELSE late OR absent OR "missingIn" OR "missingOut" END
  `, args, filters, '"workDate" DESC, id DESC');
  return { ...result, items: result.items.map(row => ({
    ...row,
    exception: exceptionKinds.filter(([key]) => row[key]).map(([, label]) => label).join(', '),
  })) };
}

export async function readAttendanceCorrections(user, filters) {
  const { args, where } = attendanceFilters(user, filters, ['attendance.manage', 'audit.hr']);
  const result = await readPage(`
    SELECT c.id, ${identity},
      modifier.full_name AS "modifiedBy",
      to_char(c.occurred_at AT TIME ZONE $5::text, 'YYYY-MM-DD HH24:MI') AS "modifiedAt",
      reviewer.full_name AS "approvedBy",
      to_char(approval.occurred_at AT TIME ZONE $5::text, 'YYYY-MM-DD HH24:MI') AS "approvedAt",
      c.reason, c.details->'changes' AS changes
    FROM audit_logs c
    JOIN attendance_records a ON a.id::text = c.entity_id
    ${employees}
    LEFT JOIN users modifier ON modifier.id = c.actor_user_id
    LEFT JOIN LATERAL (
      SELECT ar.actor_user_id, ar.occurred_at
      FROM audit_logs ar
      WHERE ar.entity_type = c.entity_type AND ar.entity_id = c.entity_id
        AND ar.action = 'change.approve' AND ar.id > c.id
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs newer
          WHERE newer.entity_type = c.entity_type AND newer.entity_id = c.entity_id
            AND newer.action = 'attendance.correct' AND newer.id > c.id AND newer.id < ar.id
        )
      ORDER BY ar.id LIMIT 1
    ) approval ON TRUE
    LEFT JOIN users reviewer ON reviewer.id = approval.actor_user_id
    WHERE c.entity_type = 'attendance_record' AND c.action = 'attendance.correct' AND ${where}
  `, args, filters, 'id DESC');
  const changeFields = [['status', 'Status'], ['checkInTime', 'Check in'], ['checkOutTime', 'Check out'], ['lateMinutes', 'Late minutes']];
  return { ...result, items: result.items.map(row => ({
    ...row,
    changes: changeFields.filter(([key]) => row.changes?.[key]).map(([key, label]) => {
      const { from, to } = row.changes[key];
      return `${label}: ${from ?? '—'} to ${to ?? '—'}`;
    }).join('\n'),
    modified: [row.modifiedBy, row.modifiedAt].filter(Boolean).join('\n'),
    approved: [row.approvedBy, row.approvedAt].filter(Boolean).join('\n'),
  })) };
}
