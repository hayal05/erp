import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { v } from '../middleware/validate.js';
import { scopeSql } from './accessScope.js';
import { pageOffset, pageResult, pageSchema } from './sql.js';
import { loadVacancies, vacancyFrom } from './vacancies.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWord } from './attendanceWord.js';

const vacancyStatuses = ['draft', 'open', 'closed'];
const applicationStatuses = ['applied', 'shortlisted', 'selected', 'rejected'];
const announcementStatuses = ['draft', 'published', 'archived'];
const statusFilter = (values, key = 'status', label = 'Status') => ({
  key, label, type: 'select', placeholder: label === 'Outcome' ? 'All outcomes' : 'All statuses',
  options: values.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
});
const vacancyFilter = { key: 'vacancyId', label: 'Vacancy ID', type: 'number', min: 1 };
const vacancySchema = { ...pageSchema, vacancyId: v.int({ min: 1 }) };
const formats = { xlsx: attendanceWorkbook, pdf: attendancePdf };
const column = (key, header, width) => ({ key, header, width });
const vacancyColumns = [
  column('vacancyId', 'Vacancy ID', 12), column('title', 'Vacancy', 26),
  column('department', 'Department', 20), column('position', 'Position', 20),
];

async function readVacancyStatus(user, filters) {
  return withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await loadVacancies(db, user, { ...filters, view: 'manage' });
    return { ...result, items: result.items.map(row => ({
      ...row, vacancyId: row.id, accepting: row.acceptingApplications ? 'Yes' : 'No',
    })) };
  });
}

async function readPage(sql, args, order, filters) {
  const { rows: [result] } = await query(`
    WITH records AS (${sql}), selected AS (
      SELECT * FROM records ORDER BY ${order} LIMIT $${args.length + 1} OFFSET $${args.length + 2}
    )
    SELECT (SELECT count(*)::int FROM records) AS total,
      COALESCE((SELECT json_agg(page_row ORDER BY ${order}) FROM selected page_row), '[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  return pageResult(result.items, filters, result.total);
}

function readApplications(user, filters, summary = false) {
  const args = [filters.vacancyId ?? null, filters.status ?? null];
  const scope = scopeSql(user, 'vacancies.review', 'se', args);
  const vacancy = 'v.id AS "vacancyId", v.title, d.name AS department, p.name AS position';
  const from = `${vacancyFrom}
    JOIN vacancy_applications a ON a.vacancy_id=v.id JOIN employees se ON se.id=a.employee_id`;
  const where = `WHERE ($1::bigint IS NULL OR v.id=$1) AND ($2::text IS NULL OR a.status=$2) AND ${scope}`;
  if (summary) {
    return readPage(`
      SELECT v.id, ${vacancy}, count(*)::int AS applications,
        count(*) FILTER (WHERE a.status='applied')::int AS applied,
        count(*) FILTER (WHERE a.status='shortlisted')::int AS shortlisted,
        count(*) FILTER (WHERE a.status='selected')::int AS selected,
        count(*) FILTER (WHERE a.status='rejected')::int AS rejected
      ${from} ${where} GROUP BY v.id, d.name, p.name
    `, args, 'id DESC', filters);
  }
  const timezone = args.push(config.company.timezone);
  return readPage(`
    SELECT a.id, ${vacancy}, a.status, a.applied_at AS sort_at,
      a.profile_snapshot->>'employeeCode' AS "employeeCode", a.profile_snapshot->>'fullName' AS "fullName",
      to_char(a.applied_at AT TIME ZONE $${timezone}::text,'YYYY-MM-DD HH24:MI') AS "appliedAt",
      to_char(a.reviewed_at AT TIME ZONE $${timezone}::text,'YYYY-MM-DD HH24:MI') AS "reviewedAt",
      reviewer.username AS "reviewedBy"
    ${from} LEFT JOIN users reviewer ON reviewer.id=a.reviewed_by_user_id ${where}
  `, args, 'sort_at DESC, id DESC', filters);
}

function readAnnouncements(_user, filters) {
  return readPage(`
    SELECT a.id, a.title, a.status, a.updated_at AS sort_at,
      CASE WHEN a.status='published' AND a.expires_on < (now() AT TIME ZONE $1::text)::date
        THEN 'Expired' ELSE initcap(a.status) END AS "visibilityStatus",
      to_char(a.created_at AT TIME ZONE $1::text,'YYYY-MM-DD HH24:MI') AS "createdAt",
      to_char(a.updated_at AT TIME ZONE $1::text,'YYYY-MM-DD HH24:MI') AS "updatedAt",
      to_char(a.published_at AT TIME ZONE $1::text,'YYYY-MM-DD HH24:MI') AS "publishedAt",
      to_char(a.expires_on,'YYYY-MM-DD') AS "expiresOn",
      COALESCE(u.username,u.full_name) AS "createdBy"
    FROM announcements a LEFT JOIN users u ON u.id=a.created_by_user_id
    WHERE ($2::text IS NULL OR a.status=$2)
  `, [config.company.timezone, filters.status ?? null], 'sort_at DESC, id DESC', filters);
}

const reviews = {
  group: 'Recruitment', permission: 'vacancies.review', additionalPermission: 'vacancies.read',
  filters: [vacancyFilter], schema: vacancySchema,
};
export const communicationReports = [
  ['vacancy-status', {
    title: 'Vacancy status', group: 'Recruitment', permission: 'vacancies.admin_read', additionalPermission: 'vacancies.read',
    exports: formats, filters: [statusFilter(vacancyStatuses)],
    schema: { ...pageSchema, status: v.enum({ values: vacancyStatuses }) },
    columns: [...vacancyColumns, column('status', 'Status', 12), column('closingOn', 'Closes on', 14),
      column('accepting', 'Accepting applications', 16), column('applicationCount', 'Visible applications', 16)],
    preview: readVacancyStatus,
  }],
  ['vacancy-application-outcomes', {
    ...reviews, title: 'Vacancy application outcomes', exports: formats,
    filters: [...reviews.filters, statusFilter(applicationStatuses, 'status', 'Outcome')],
    schema: { ...reviews.schema, status: v.enum({ values: applicationStatuses }) },
    columns: [...vacancyColumns, column('employeeCode', 'Employee ID', 14), column('fullName', 'Applicant', 22),
      column('status', 'Outcome', 13), column('appliedAt', 'Applied on', 15),
      column('reviewedBy', 'Reviewed by', 18), column('reviewedAt', 'Reviewed on', 15)],
    preview: readApplications,
  }],
  ['recruitment-summary', {
    ...reviews, title: 'Recruitment summary', exports: { docx: attendanceWord },
    description: 'Counts applications in your review scope by vacancy and current outcome.',
    columns: [...vacancyColumns, column('applications', 'Total', 9), column('applied', 'Applied', 10),
      column('shortlisted', 'Shortlisted', 12), column('selected', 'Selected', 11), column('rejected', 'Rejected', 11)],
    preview: (user, filters) => readApplications(user, filters, true),
  }],
  ['announcement-history', {
    title: 'Announcement history', group: 'Announcements', permission: 'announcements.admin_read',
    additionalPermission: 'announcements.read', exports: formats,
    filters: [statusFilter(announcementStatuses)], schema: { ...pageSchema, status: v.enum({ values: announcementStatuses }) },
    columns: [column('id', 'Announcement ID', 14), column('title', 'Title', 28), column('status', 'Saved status', 13),
      column('visibilityStatus', 'Current state', 14), column('createdBy', 'Created by', 20),
      column('createdAt', 'Created on', 16), column('publishedAt', 'Last published', 16),
      column('expiresOn', 'Expires on', 13), column('updatedAt', 'Last updated', 16)],
    preview: readAnnouncements,
  }],
];
