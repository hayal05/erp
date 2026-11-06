import { query } from '../db/pool.js';
import { v } from '../middleware/validate.js';
import { scopeSql } from './accessScope.js';
import { pageOffset, pageResult, pageSchema } from './sql.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';

const permission = 'appraisals.read';
const states = {
  not_started: 'Not started', draft: 'Draft', returned: 'Returned', submitted: 'Awaiting approval', approved: 'Approved',
};

function visibleAssignments(user, args) {
  const scope = scopeSql(user, permission, 'e', args);
  return `
    SELECT a.cycle_id AS "cycleId", c.name AS cycle, a.employee_id AS "employeeId",
      e.employee_code AS "employeeCode", u.full_name AS employee,
      e.department_id AS "departmentId", d.name AS department,
      e.position_id AS "positionId", COALESCE(p.name,e.job_title) AS position,
      e.job_grade_id AS "gradeId", g.name AS grade,
      reviewer.full_name AS reviewer, approver.full_name AS approver,
      CASE WHEN r.approved_at IS NOT NULL THEN 'approved' WHEN r.submitted_at IS NOT NULL THEN 'submitted'
        WHEN r.returned_at IS NOT NULL THEN 'returned' WHEN r.version IS NOT NULL THEN 'draft' ELSE 'not_started' END AS status,
      CASE WHEN r.approved_at IS NOT NULL THEN (r.result->'rating'->>'score')::numeric END AS score,
      CASE WHEN r.approved_at IS NOT NULL THEN (r.result->'rating'->>'ratingScore')::numeric END AS "ratingScore",
      CASE WHEN r.approved_at IS NOT NULL THEN r.result->'rating'->>'label' END AS rating,
      to_char(r.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS "approvedAt"
    FROM appraisal_assignments a JOIN appraisal_cycles c ON c.id=a.cycle_id
    JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id
    JOIN users reviewer ON reviewer.id=a.reviewer_id
    LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id
    LEFT JOIN position_job_grades g ON g.id=e.job_grade_id
    LEFT JOIN appraisal_reviews r ON r.cycle_id=a.cycle_id AND r.employee_id=a.employee_id
    LEFT JOIN users approver ON approver.id=r.approved_by
    WHERE c.opened_at IS NOT NULL AND ${scope}
  `;
}

function lookup(key, label, display = key) {
  return `(SELECT COALESCE(json_agg(items ORDER BY name,id),'[]'::json)
    FROM (SELECT DISTINCT ${key} AS id,${display} AS name FROM visible WHERE ${key} IS NOT NULL) items) AS ${label}`;
}

export async function appraisalReportLookups(user) {
  const args = [];
  const { rows: [result] } = await query(`
    WITH visible AS (${visibleAssignments(user, args)})
    SELECT ${lookup('"cycleId"', 'cycles', 'cycle')},
      ${lookup('"departmentId"', 'departments', 'department')},
      ${lookup('"positionId"', 'positions', "concat_ws(' · ', department, position)")},
      ${lookup('"gradeId"', 'grades', "concat_ws(' · ', department, position, grade)")},
      ${lookup('rating', 'ratings')}
  `, args);
  return result;
}

async function readAppraisalReport(user, filters, summary) {
  const args = ['cycleId','departmentId','positionId','gradeId','status','rating'].map(key => filters[key] ?? null);
  const visible = visibleAssignments(user, args);
  const rows = summary ? `
    SELECT "cycleId"::text || ':' || COALESCE("departmentId"::text,'none') AS id, cycle, department,
      count(*)::int AS total,
      count(*) FILTER (WHERE status='not_started')::int AS "notStarted",
      count(*) FILTER (WHERE status='draft')::int AS draft,
      count(*) FILTER (WHERE status='returned')::int AS returned,
      count(*) FILTER (WHERE status='submitted')::int AS submitted,
      count(*) FILTER (WHERE status='approved')::int AS approved,
      round(avg(score),2) AS "averageScore"
    FROM filtered GROUP BY "cycleId",cycle,"departmentId",department
  ` : `SELECT *, "cycleId"::text || ':' || "employeeId"::text AS id FROM filtered`;
  const order = summary ? 'cycle, department NULLS LAST, id' : 'cycle, employee, id';
  const { rows: [result] } = await query(`
    WITH visible AS (${visible}), filtered AS (
      SELECT * FROM visible WHERE ($1::bigint IS NULL OR "cycleId"=$1)
        AND ($2::bigint IS NULL OR "departmentId"=$2) AND ($3::bigint IS NULL OR "positionId"=$3)
        AND ($4::bigint IS NULL OR "gradeId"=$4) AND ($5::text IS NULL OR status=$5)
        AND ($6::text IS NULL OR rating=$6)
    ), report_rows AS (${rows}), selected AS (
      SELECT * FROM report_rows ORDER BY ${order} LIMIT $${args.length + 1} OFFSET $${args.length + 2}
    )
    SELECT (SELECT count(*)::int FROM report_rows) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY ${order}) FROM selected),'[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  const items = summary ? result.items : result.items.map(row => ({ ...row, status: states[row.status] }));
  return pageResult(items, filters, result.total);
}

const select = (key, label, lookup, placeholder) => ({ key, label, type: 'select', lookup, placeholder });
const base = {
  group: 'Performance Appraisal', permission, lookupPath: '/reports/appraisal-lookups',
  exports: { xlsx: attendanceWorkbook, pdf: attendancePdf },
  description: 'Departments, positions and grades reflect current employee assignments. Scores and ratings appear after approval.',
  filters: [
    select('cycleId', 'Cycle', 'cycles', 'All cycles'),
    select('departmentId', 'Department', 'departments', 'All departments'),
    select('positionId', 'Position', 'positions', 'All positions'),
    select('gradeId', 'Job grade', 'grades', 'All job grades'),
    { key: 'status', label: 'Status', type: 'select', placeholder: 'All statuses',
      options: Object.entries(states).map(([value, label]) => ({ value, label })) },
    select('rating', 'Rating', 'ratings', 'All ratings'),
  ],
  schema: { ...pageSchema, cycleId: v.int({ min: 1 }), departmentId: v.int({ min: 1 }),
    positionId: v.int({ min: 1 }), gradeId: v.int({ min: 1 }),
    status: v.enum({ values: Object.keys(states) }), rating: v.string({ max: 120 }) },
};
const column = (key, header, width = 14) => ({ key, header, width });
export const appraisalReports = [
  ['appraisal-results', {
    ...base, title: 'Appraisal results',
    columns: [
      column('cycle', 'Cycle', 22), column('employeeCode', 'Employee ID', 13), column('employee', 'Employee', 22),
      column('department', 'Department', 17), column('position', 'Position', 17), column('grade', 'Job grade', 15),
      column('status', 'Status', 16), column('score', 'Score (%)', 10), column('ratingScore', 'Rating score (%)', 12),
      column('rating', 'Rating', 20), column('reviewer', 'Reviewer', 16), column('approver', 'Approver', 16),
      column('approvedAt', 'Approved (UTC)', 18),
    ],
    preview: (user, filters) => readAppraisalReport(user, filters, false),
  }],
  ['appraisal-summary', {
    ...base, title: 'Appraisal summary',
    columns: [
      column('cycle', 'Cycle', 25), column('department', 'Department', 23), column('total', 'Total'),
      column('notStarted', 'Not started'), column('draft', 'Draft'), column('returned', 'Returned'),
      column('submitted', 'Awaiting approval'), column('approved', 'Approved'), column('averageScore', 'Average approved score (%)', 18),
    ],
    preview: (user, filters) => readAppraisalReport(user, filters, true),
  }],
];
