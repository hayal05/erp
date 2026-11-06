import { HttpError } from '../middleware/error.js';
import { v } from '../middleware/validate.js';
import { validationError } from './dbErrors.js';
import { JOB_TITLE_MAX } from './hrSchemas.js';
import { SALARY_SCHEMA } from './salaryProfiles.js';
import { pageSchema, pageOffset, pageResult } from './sql.js';

export const jobGradeBody = { name: v.string({ required: true, max: JOB_TITLE_MAX }),
  basicMinor: SALARY_SCHEMA.basicMinor, allowanceMinor: SALARY_SCHEMA.allowanceMinor };
export const jobGradeListQuery = { ...pageSchema, search: v.string({ max: JOB_TITLE_MAX }) };
export const toJobGrade = row => ({
  id: Number(row.id), name: row.name, basicMinor: Number(row.basic_minor), allowanceMinor: Number(row.allowance_minor),
});

export async function readJobGrades(db, positionId, filters) {
  const args = [positionId, filters.search ?? ''];
  const { rows: [result] } = await db.query(`
    WITH grades AS (
      SELECT id,name,basic_minor,allowance_minor FROM position_job_grades
      WHERE position_id=$1 AND ($2='' OR strpos(lower(name), lower($2))>0)
    ), selected AS (
      SELECT * FROM grades
      ORDER BY name,id LIMIT $3 OFFSET $4
    )
    SELECT (SELECT count(*)::int FROM grades) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY name,id) FROM selected),'[]'::json) AS items
  `, [...args, filters.pageSize, pageOffset(filters)]);
  return { ...pageResult(result.items.map(toJobGrade), filters, result.total), positionId };
}

export async function jobGradePay(db, position, gradeId) {
  if (gradeId == null) return position;
  if (!position) throw validationError({ jobGradeId: 'Choose a position first' });
  const { rows: [grade] } = await db.query(
    'SELECT * FROM position_job_grades WHERE position_id=$1 AND id=$2 FOR SHARE', [position.id, gradeId]);
  if (!grade) throw validationError({ jobGradeId: 'Choose a grade for this position' });
  const { basicMinor, allowanceMinor } = toJobGrade(grade);
  return { ...position, basicMinor, allowanceMinor };
}

export const jobGradeNotFound = () => new HttpError(404, 'Job grade not found', 'not_found');
