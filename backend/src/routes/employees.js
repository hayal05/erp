import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { hashPassword, passwordProblem } from '../services/password.js';
import { likePattern, pageOffset, pageResult, setClause } from '../services/sql.js';
import { translateDbError, validationError } from '../services/dbErrors.js';
import { loadAssignablePosition, positionSalary } from '../services/positions.js';
import { saveSalaryProfile } from '../services/salaryProfiles.js';
import { employeeCreate, employeeListQuery, employeeUpdate, idParams, reasonBody } from '../services/hrSchemas.js';

// Employees are never hard-deleted (attendance, leave and payroll history point at them):
// there is deliberately no DELETE route. Deactivate instead; that also blocks their login.
const router = Router();
router.use(noStore, requireHr);

const FROM = `FROM employees e
  JOIN users u ON u.id = e.user_id
  LEFT JOIN departments d ON d.id = e.department_id
  JOIN shifts s ON s.id = e.shift_id
  LEFT JOIN positions p ON p.id = e.position_id`;
const COLUMNS = `e.id, e.employee_code, e.user_id, u.full_name, u.email, e.phone, e.department_id,
  d.name AS department_name, e.position_id, p.name AS position_name, e.job_title, to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
  e.employment_type, e.status, e.shift_id, s.name AS shift_name, e.created_at`;

const optId = (x) => (x == null ? null : Number(x));
const toEmployee = (r) => ({
  id: Number(r.id), employeeCode: r.employee_code, userId: Number(r.user_id),
  fullName: r.full_name, email: r.email, phone: r.phone,
  departmentId: optId(r.department_id), departmentName: r.department_name,
  positionId: optId(r.position_id), positionName: r.position_name ?? null, jobTitle: r.job_title,
  startDate: r.start_date, employmentType: r.employment_type, status: r.status,
  shiftId: Number(r.shift_id), shiftName: r.shift_name, createdAt: r.created_at,
});
async function findEmployee(db, id) {
  const { rows: [r] } = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE e.id = $1`, [id]);
  return r ? toEmployee(r) : null;
}
const notFound = () => new HttpError(404, 'Employee not found', 'not_found');

router.get('/', validate(employeeListQuery, 'query'), wrap(async (req, res) => {
  const q = req.query;
  const params = [];
  const where = [];
  if (q.search) {
    params.push(likePattern(q.search));
    const n = `$${params.length}`;
    where.push(`(u.full_name ILIKE ${n} ESCAPE '\\' OR u.email ILIKE ${n} ESCAPE '\\' OR e.employee_code ILIKE ${n} ESCAPE '\\')`);
  }
  for (const [value, column] of [[q.status, 'e.status'], [q.departmentId, 'e.department_id'], [q.shiftId, 'e.shift_id']]) {
    if (value === undefined) continue;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    query(`SELECT ${COLUMNS} ${FROM} ${whereSql}
           ORDER BY lower(u.full_name), e.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, pageOffset(q)]),
    query(`SELECT count(*)::int AS n FROM employees e JOIN users u ON u.id = e.user_id ${whereSql}`, params),
  ]);
  res.json(pageResult(rows.map(toEmployee), q, total));
}));

router.get('/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const employee = await findEmployee({ query }, req.params.id);
  if (!employee) throw notFound();
  res.json(employee);
}));

// Creates the login (users row, role 'employee') and the employee record together.
router.post('/', validate(employeeCreate), wrap(async (req, res) => {
  const b = req.body;
  const problem = passwordProblem(b.password);
  if (problem) throw validationError({ password: problem });
  const hash = await hashPassword(b.password); // slow on purpose; done before the transaction opens

  const created = await withTransaction(async (db) => {
    // A position always applies on create: its name becomes the job title and its salary package becomes the employee's
    // salary profile, in this same transaction (any failure rolls back the login, the employee and the salary together).
    // Salary figures in the request are never read (not in the schema).
    const position = b.positionId != null ? await loadAssignablePosition(db, b.positionId, b.departmentId ?? null) : null;
    let shiftId = b.shiftId;
    if (shiftId == null) {
      const { rows: [first] } = await db.query('SELECT id FROM shifts ORDER BY id LIMIT 1');
      if (!first) throw validationError({ shiftId: 'Create a shift first' });
      shiftId = first.id;
    }
    const { rows: [user] } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, 'employee') RETURNING id`,
      [b.email, b.fullName, hash]);
    const { rows: [emp] } = await db.query(
      `INSERT INTO employees (employee_code, user_id, phone, department_id, position_id, job_title, start_date, employment_type, shift_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [b.employeeCode, user.id, b.phone ?? null, b.departmentId ?? null, position?.id ?? null, position ? position.name : b.jobTitle ?? null,
        b.startDate, b.employmentType, shiftId]);
    await audit(db, { actorId: req.user.id, action: 'employee.create', entityType: 'employee', entityId: emp.id,
      details: { employeeCode: b.employeeCode, userId: Number(user.id), departmentId: b.departmentId ?? null, shiftId: Number(shiftId),
        positionId: position?.id ?? null, salaryApplied: Boolean(position) } });
    if (position) await saveSalaryProfile(db, { employeeId: emp.id, actorId: req.user.id, values: positionSalary(position), source: { type: 'position', positionId: position.id } });
    return findEmployee(db, emp.id);
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

const USER_COLUMNS = { fullName: 'full_name', email: 'email' };
const EMPLOYEE_COLUMNS = {
  employeeCode: 'employee_code', phone: 'phone', departmentId: 'department_id', positionId: 'position_id', jobTitle: 'job_title',
  startDate: 'start_date', employmentType: 'employment_type', shiftId: 'shift_id',
};

// Partial update. Status is not editable here (use activate/deactivate); passwords are not either.
// Position rules (task 6.5), all inside one transaction with the employee row locked:
//  - positionId = a position of the (new) department: the position name becomes job_title; the salary is replaced by the
//    position's package ONLY when applyPositionSalary is true (false or omitted keeps the current salary).
//  - positionId = null clears the position and keeps the salary; job_title keeps its last value unless the request sets one.
//  - changing the department without choosing a position of the new department clears the position (the database would
//    refuse the mismatch), in the same UPDATE statement as the department change.
//  - while a position is held, job_title belongs to the position: a jobTitle in the request is ignored.
//  - applyPositionSalary: true without a positionId is 422, so a salary can never be replaced by accident.
router.patch('/:id', validate(idParams, 'params'), validate(employeeUpdate), wrap(async (req, res) => {
  const { id } = req.params;
  const { applyPositionSalary, ...fields } = req.body;
  if (!Object.keys(req.body).length) throw new HttpError(400, 'No changes supplied', 'validation', { fields: { _: 'Provide at least one field to change' } });
  const assigning = fields.positionId != null;
  if (applyPositionSalary && !assigning) {
    throw new HttpError(422, 'Choose a position to apply its salary', 'validation', { fields: { applyPositionSalary: 'Choose a position to apply its salary' } });
  }

  const updated = await withTransaction(async (db) => {
    const { rows: [row] } = await db.query('SELECT user_id, department_id, position_id FROM employees WHERE id = $1 FOR UPDATE', [id]);
    if (!row) throw notFound();
    const holdsPosition = row.position_id != null;
    const departmentId = Object.hasOwn(fields, 'departmentId') ? fields.departmentId : optId(row.department_id);

    let position = null;
    if (assigning) {
      position = await loadAssignablePosition(db, fields.positionId, departmentId);
      fields.jobTitle = position.name;
    } else if (holdsPosition && !Object.hasOwn(fields, 'positionId') && departmentId !== optId(row.department_id)) {
      fields.positionId = null; // new department, no position chosen in it
    } else if (holdsPosition && !Object.hasOwn(fields, 'positionId')) {
      delete fields.jobTitle; // still on the same position: its name stays the title
    }

    const before = await findEmployee(db, id);
    for (const [table, columns, key] of [['users', USER_COLUMNS, row.user_id], ['employees', EMPLOYEE_COLUMNS, id]]) {
      const { sets, params } = setClause(columns, fields);
      if (sets.length) await db.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`, [key, ...params]);
    }
    if (applyPositionSalary) {
      await saveSalaryProfile(db, { employeeId: id, actorId: req.user.id, values: positionSalary(position), source: { type: 'position', positionId: position.id } });
    }
    const after = await findEmployee(db, id);
    const changes = diffFields(before, after, Object.keys(fields));
    if (Object.keys(changes).length) {
      await audit(db, { actorId: req.user.id, action: 'employee.update', entityType: 'employee', entityId: id,
        details: { changes, ...(position ? { positionId: position.id, salaryApplied: Boolean(applyPositionSalary) } : {}) } });
    }
    return after;
  }).catch((err) => { throw translateDbError(err); });
  res.json(updated);
}));

// Idempotent. Deactivating also disables the login and signs the person out everywhere.
const setStatus = (status) => wrap(async (req, res) => {
  const { id } = req.params;
  const active = status === 'active';
  const employee = await withTransaction(async (db) => {
    const { rows: [cur] } = await db.query('SELECT user_id, status FROM employees WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound();
    if (cur.status !== status) {
      await db.query('UPDATE employees SET status = $2 WHERE id = $1', [id, status]);
      await db.query('UPDATE users SET is_active = $2 WHERE id = $1', [cur.user_id, active]);
      if (!active) await db.query('DELETE FROM sessions WHERE user_id = $1', [cur.user_id]);
      await audit(db, { actorId: req.user.id, action: active ? 'employee.activate' : 'employee.deactivate',
        entityType: 'employee', entityId: id, reason: req.body.reason ?? null });
    }
    return findEmployee(db, id);
  });
  res.json(employee);
});
router.post('/:id/deactivate', validate(idParams, 'params'), validate(reasonBody), setStatus('inactive'));
router.post('/:id/activate', validate(idParams, 'params'), validate(reasonBody), setStatus('active'));

export default router;
