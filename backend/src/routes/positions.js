import {scopeSql,departmentScopeSql} from '../services/accessScope.js';
import {approvalWrap as wrap} from '../middleware/approval.js';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { parse, validate, v } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { likePattern, pageOffset, pageResult } from '../services/sql.js';
import { isFkViolation, translateDbError, validationError } from '../services/dbErrors.js';
import { idParams, positionListQuery } from '../services/hrSchemas.js';
import { hasPermission } from '../services/permissions.js';
import { jobGradeBody, jobGradeListQuery, jobGradeNotFound, readJobGrades, toJobGrade } from '../services/jobGrades.js';
import { POSITION_COLUMNS, parsePosition, toPosition } from '../services/positions.js';

// Positions (task 6.3). Two routers share this file: `departmentPositions` is mounted by routes/departments.js at
// /api/departments/:id/positions (list + create, the department comes from the URL), and the default export is mounted
// at /api/positions (edit + delete by id). Both sit behind HR-only guards; a locked tablet session is refused by lockGate.
// A position is a template: nothing here changes any employee's salary (task 6.5 copies a package at assignment time).
const SELECT = `SELECT p.id, p.department_id, p.name, p.basic_minor, p.allowance_minor, p.allowance_taxable, p.allowance_pensionable,
  p.pension_applies, p.requires_job_grade, (SELECT count(*)::int FROM employees e WHERE e.position_id = p.id) AS employee_count FROM positions p`;
async function findPosition(db, id) {
  const { rows: [r] } = await db.query(`${SELECT} WHERE p.id = $1`, [id]);
  return r ? toPosition(r) : null;
}
const notFound = () => new HttpError(404, 'Position not found', 'not_found');
const noDepartment = () => new HttpError(404, 'Department not found', 'not_found');

// Validates the body with the shared salary rules and replaces req.body with the cleaned copy (like PUT /salary-profiles).
function positionBody(req, res, next) {
  const result = parsePosition(req.body);
  if (result.errors) return next(validationError(result.errors));
  req.body = result.value;
  next();
}

function positionCreateBody(req, res, next) {
  const body = req.body;
  if (body?.initialGrades === undefined && body?.initialGrade === undefined) return positionBody(req, res, next);
  const position = parsePosition(body);
  if (position.errors) return next(validationError(position.errors));
  const grades = body.initialGrades === undefined ? [body.initialGrade] : body.initialGrades;
  if (!Array.isArray(grades) || !grades.length) return next(validationError({ initialGrades: 'Add at least one job grade' }));
  const parsed = [];
  const names = new Set();
  for (const grade of grades) {
    const { value, errors } = parse(jobGradeBody, grade);
    if (errors) return next(validationError({ initialGrades: 'Each grade needs a valid name, basic salary and allowance' }));
    const name = value.name.toLowerCase();
    if (names.has(name)) return next(validationError({ initialGrades: 'Grade names must be unique within the position' }));
    names.add(name);
    parsed.push(value);
  }
  // Keep the existing single-grade request shape compatible with pending and older clients.
  req.body = body.initialGrades === undefined
    ? { ...position.value, initialGrade: parsed[0] }
    : { ...position.value, basicMinor: 0, allowanceMinor: 0, initialGrades: parsed };
  next();
}

async function insertGrade(db, positionId, grade) {
  const { rows: [saved] } = await db.query(
    'INSERT INTO position_job_grades(position_id,name,basic_minor,allowance_minor) VALUES($1,$2,$3,$4) RETURNING *',
    [positionId, grade.name, grade.basicMinor, grade.allowanceMinor]);
  return saved;
}

// ---- /api/departments/:id/positions
export const departmentPositions = Router({ mergeParams: true });
departmentPositions.use(noStore, requirePermission('organization.read'));
departmentPositions.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('organization.manage')(req,res,next));

departmentPositions.get('/', validate(idParams, 'params'), validate(positionListQuery, 'query'), wrap(async (req, res) => {
  const { id } = req.params;
  const q = req.query;
  if (!(await query('SELECT 1 FROM departments WHERE id = $1', [id])).rowCount) throw noDepartment();
  const params = q.search ? [id, likePattern(q.search)] : [id];
  const where = q.search ? `WHERE p.department_id = $1 AND p.name ILIKE $2 ESCAPE '\\'` : 'WHERE p.department_id = $1';
  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    query(`${SELECT} ${where} ORDER BY lower(p.name), p.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n FROM positions p ${where}`, params),
  ]);
  const args=[id],scope=scopeSql(req.user,'organization.read','e',args);
  const {rows:counts}=await query(`SELECT position_id,count(*)::int n FROM employees e WHERE department_id=$1 AND ${scope} GROUP BY position_id`,args);
  res.json(pageResult(rows.map(r=>toPosition({...r,employee_count:counts.find(c=>Number(c.position_id)===Number(r.id))?.n??0})), q, total));
}));

departmentPositions.post('/', validate(idParams, 'params'), positionCreateBody, wrap(async (req, res) => {
  const { id } = req.params;
  const { initialGrade, initialGrades, ...b } = req.body;
  const created = await withTransaction(async (db) => {
    // FOR SHARE: a concurrent department delete waits for this transaction instead of orphaning the new position.
    if (!(await db.query('SELECT 1 FROM departments WHERE id = $1 FOR SHARE', [id])).rowCount) throw noDepartment();
    const cols = Object.values(POSITION_COLUMNS);
    const { rows: [row] } = await db.query(
      `INSERT INTO positions (department_id, requires_job_grade, ${cols.join(', ')}) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
      [id, Boolean(initialGrades), ...Object.keys(POSITION_COLUMNS).map((key) => b[key])]);
    await audit(db, { actorId: req.user.id, action: 'position.create', entityType: 'position', entityId: row.id, details: { departmentId: Number(id), ...b } });
    for (const input of initialGrades ?? (initialGrade ? [initialGrade] : [])) {
      const grade = await insertGrade(db, row.id, input);
      await audit(db, { actorId: req.user.id, action: 'position.grade.create', entityType: 'position', entityId: row.id,
        details: { gradeId: Number(grade.id), ...input } });
    }
    return findPosition(db, row.id);
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

// ---- /api/positions
const router = Router();
router.get('/:id/grades', noStore, requireAuth, validate(idParams, 'params'), validate(jobGradeListQuery, 'query'), wrap(async (req, res) => {
  const args = [req.params.id];
  const scopes = ['organization.read', 'employees.manage'].filter(permission => hasPermission(req.user, permission))
    .map(permission => departmentScopeSql(req.user, permission, 'p.department_id', args));
  if (!scopes.length) throw new HttpError(403, 'You do not have access to job grades', 'forbidden');
  const result = await withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (!(await db.query(`SELECT 1 FROM positions p WHERE p.id=$1 AND (${scopes.join(' OR ')})`, args)).rowCount) throw notFound();
    return readJobGrades(db, req.params.id, req.query);
  });
  res.json(result);
}));
router.use(noStore, requirePermission('organization.read'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('organization.manage')(req,res,next));

function saveGrade(editing) {
  return wrap(async (req, res) => {
    const { id, gradeId } = req.params;
    const { name, basicMinor, allowanceMinor } = req.body;
    const grade = await withTransaction(async db => {
      // Serialize with position salary reads and include grade changes in existing position approval fingerprints.
      if (!(await db.query('UPDATE positions SET updated_at=now() WHERE id=$1', [id])).rowCount) throw notFound();
      const args = [id, name, basicMinor, allowanceMinor];
      const before = editing ? (await db.query('SELECT * FROM position_job_grades WHERE position_id=$1 AND id=$2', [id, gradeId])).rows[0] : null;
      if (editing && !before) throw jobGradeNotFound();
      const saved = editing
        ? (await db.query('UPDATE position_job_grades SET name=$2,basic_minor=$3,allowance_minor=$4 WHERE position_id=$1 AND id=$5 RETURNING *', [...args, gradeId])).rows[0]
        : await insertGrade(db, id, req.body);
      const item = toJobGrade(saved);
      const changes = before ? diffFields(toJobGrade(before), item, Object.keys(jobGradeBody)) : undefined;
      await audit(db, { actorId: req.user.id, action: editing ? 'position.grade.update' : 'position.grade.create',
        entityType: 'position', entityId: id, details: { gradeId: item.id, ...(editing ? { changes, gradeName: item.name } : req.body) } });
      return item;
    }).catch(err => {
      if (err.code === '23505' && err.constraint === 'position_job_grades_name_key') {
        throw new HttpError(409, 'A grade with this name already exists for this position.', 'conflict', { fields: { name: 'Choose a different grade name' } });
      }
      throw err;
    });
    res.status(editing ? 200 : 201).json(grade);
  });
}
router.post('/:id/grades', validate(idParams, 'params'), validate(jobGradeBody), saveGrade(false));
router.patch('/:id/grades/:gradeId', validate({ ...idParams, gradeId: v.int({ required: true, min: 1 }) }, 'params'), validate(jobGradeBody), saveGrade(true));

// Full replacement of the editable fields (name + the five salary fields). The department never changes here.
router.patch('/:id', validate(idParams, 'params'), positionBody, wrap(async (req, res) => {
  const { id } = req.params;
  const updated = await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query(`${SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [id]);
    if (!cur) throw notFound();
    const before = toPosition(cur);
    const changes = diffFields(before, req.body, Object.keys(POSITION_COLUMNS));
    if (Object.keys(changes).length) {
      await db.query(`UPDATE positions SET ${Object.values(POSITION_COLUMNS).map((col, i) => `${col} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...Object.keys(POSITION_COLUMNS).map((key) => req.body[key])]);
      // Employees on this position keep their salary (it was copied once) but their job title follows the position's name.
      let titlesUpdated = 0;
      if (changes.name) {
        titlesUpdated = (await db.query('UPDATE employees SET job_title = $2 WHERE position_id = $1', [id, req.body.name])).rowCount;
      }
      await audit(db, { actorId: req.user.id, action: 'position.update', entityType: 'position', entityId: id,
        details: { departmentId: before.departmentId, changes, ...(changes.name ? { jobTitlesUpdated: titlesUpdated } : {}) } });
    }
    return findPosition(db, id);
  }).catch((err) => { throw translateDbError(err); });
  res.json(updated);
}));

// A position nobody holds can be removed; the foreign key (ON DELETE RESTRICT) refuses while any employee,
// active or not, is still on it.
router.delete('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const { id } = req.params;
  await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query('SELECT name, department_id FROM positions WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound();
    try {
      await db.query('DELETE FROM positions WHERE id = $1', [id]);
    } catch (err) {
      if (isFkViolation(err) && err.constraint?.startsWith('internal_vacancies')) throw new HttpError(409, 'Position is used by an internal vacancy.', 'in_use');
      if (isFkViolation(err) && err.constraint?.startsWith('appraisal_templates')) throw new HttpError(409, 'Position or one of its job grades is used by an appraisal template.', 'in_use');
      if (isFkViolation(err)) throw new HttpError(409, 'Position is still assigned to employees. Move them first.', 'in_use');
      throw err;
    }
    await audit(db, { actorId: req.user.id, action: 'position.delete', entityType: 'position', entityId: id, details: { departmentId: Number(cur.department_id), name: cur.name } });
  });
  res.sendStatus(204);
}));

export default router;
