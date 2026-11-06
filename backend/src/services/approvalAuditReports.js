import { query, withTransaction } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { v } from '../middleware/validate.js';
import { AUDIT_AREAS, loadAuditActivity } from './auditActivity.js';
import { requestVisibilitySql } from './requestScope.js';
import { pageOffset, pageResult, pageSchema } from './sql.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';
import { attendanceWord } from './attendanceWord.js';

const dates = [
  { key: 'from', label: 'From date (UTC)', type: 'date', default: '' },
  { key: 'to', label: 'To date (UTC)', type: 'date', default: '' },
];
const rangeSchema = { ...pageSchema, from: v.date(), to: v.date() };
const approvalAreas = ['hr', 'finance'];
const decisions = ['approved', 'rejected', 'cancelled'];
const choice = (key, label, values, names = {}) => ({
  key, label, type: 'select', placeholder: `All ${label.toLowerCase()}s`,
  options: values.map(value => ({ value, label: names[value] ?? value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) })),
});
const approvalArea = choice('department', 'Area', approvalAreas, { hr: 'HR', finance: 'Finance' });
const column = (key, header, width) => ({ key, header, width });
const approvalColumns = [
  column('id', 'Request ID', 12), column('department', 'Area', 11),
  column('permission', 'Activity', 24), column('operation', 'Operation', 28),
  column('requester', 'Requested by', 20), column('requestedAt', 'Requested (UTC)', 18),
];
const exports = { xlsx: attendanceWorkbook, pdf: attendancePdf };
const approvals = {
  group: 'Approvals', permission: 'approvals.read', exports,
  filters: [...dates, approvalArea],
  schema: { ...rangeSchema, department: v.enum({ values: approvalAreas }) },
};

function checkDates({ from, to }) {
  if (from && to && from > to) throw new HttpError(400, 'End date must be on or after the start date.', 'validation');
}

async function readApprovals(user, filters, pending) {
  checkDates(filters);
  const dateField = pending ? 'c.requested_at' : 'c.reviewed_at';
  const args = [user.id, approvalAreas, filters.department ?? null, filters.status ?? null, filters.from ?? null, filters.to ?? null];
  const visibility = requestVisibilitySql(user, args);
  const offset = args.length;
  const { rows: [result] } = await query(`
    WITH events AS (
      SELECT c.id, upper(c.department) AS department, c.permission, c.method || ' ' || c.path AS operation,
        COALESCE(u.username,u.full_name) AS requester,
        to_char(c.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS "requestedAt",
        COALESCE(r.username,r.full_name) AS reviewer,
        to_char(c.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS "reviewedAt",
        c.status, c.review_reason AS reason, ${dateField} AS sort_at
      FROM change_requests c JOIN users u ON u.id=c.requester_id LEFT JOIN users r ON r.id=c.reviewer_id
      WHERE ${visibility} AND (c.requester_id=$1 OR c.department=ANY($2::text[]))
        AND ($3::text IS NULL OR c.department=$3)
        AND ($4::text IS NULL OR c.status=$4)
        AND c.status ${pending ? '=' : '<>'} 'pending'
        AND ($5::date IS NULL OR ${dateField} >= ($5::date::timestamp AT TIME ZONE 'UTC'))
        AND ($6::date IS NULL OR ${dateField} < (($6::date+1)::timestamp AT TIME ZONE 'UTC'))
    ), selected AS (
      SELECT * FROM events ORDER BY sort_at DESC, id DESC LIMIT $${offset + 1} OFFSET $${offset + 2}
    )
    SELECT (SELECT count(*)::int FROM events) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY sort_at DESC, id DESC) FROM selected), '[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  return pageResult(result.items, filters, result.total);
}

function describeChanges(changes) {
  const value = v => v == null ? '—' : Array.isArray(v) ? v.join(', ') : String(v);
  return changes.map(change => Object.hasOwn(change, 'value')
    ? `${change.field}: ${value(change.value)}`
    : `${change.field}: ${value(change.from)} → ${value(change.to)}`).join('\n');
}

async function readChangeHistory(user, filters) {
  checkDates(filters);
  return withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data = await loadAuditActivity(db, user, filters, { includeSummary: false });
    return { ...data, items: data.items.map(row => ({
      ...row, at: new Date(row.at).toISOString().slice(0, 16).replace('T', ' '),
      changes: describeChanges(row.changes),
    })) };
  });
}

export const approvalAuditReports = [
  ['approvals-pending', {
    ...approvals, title: 'Pending approvals', columns: approvalColumns,
    preview: (user, filters) => readApprovals(user, filters, true),
  }],
  ['approval-decisions', {
    ...approvals, title: 'Approval decision review', exports: { ...exports, docx: attendanceWord },
    filters: [...approvals.filters, choice('status', 'Decision', decisions)],
    schema: { ...approvals.schema, status: v.enum({ values: decisions }) },
    columns: [...approvalColumns, column('status', 'Decision', 13), column('reviewer', 'Decided by', 20),
      column('reviewedAt', 'Decided (UTC)', 18), { ...column('reason', 'Reason', 24), pdfMaxHeight: 140 }],
    preview: (user, filters) => readApprovals(user, filters, false),
  }],
  ['audit-change-history', {
    title: 'Audit change history', group: 'Audit', permissions: ['audit.hr', 'audit.finance', 'audit.access'], exports,
    filters: [...dates, { ...choice('area', 'Area', Object.keys(AUDIT_AREAS)), default: 'all', required: true }],
    schema: { ...rangeSchema, area: v.enum({ values: Object.keys(AUDIT_AREAS), default: 'all' }) },
    columns: [column('at', 'Changed (UTC)', 18), column('actor', 'Changed by', 19), column('action', 'Action', 24),
      column('type', 'Record type', 19), column('recordId', 'Record ID', 12),
      { ...column('changes', 'Changes', 38), pdfMaxHeight: 210 },
      { ...column('reason', 'Reason', 23), pdfMaxHeight: 140 }],
    preview: readChangeHistory,
  }],
];
