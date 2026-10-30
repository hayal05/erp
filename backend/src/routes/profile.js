import { config } from '../config.js';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requireEmployee } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { HttpError, wrap } from '../middleware/error.js';
import { validate, v } from '../middleware/validate.js';
import { pageSchema, pageOffset, pageResult } from '../services/sql.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(noStore, requireEmployee);
const missing = () => new HttpError(404, 'Employee profile not found', 'not_found');
// User identity always comes from the session; there is no employee-id input.
router.get('/', wrap(async (req, res) => {
  const { rows: [r] } = await query(`SELECT e.id, e.employee_code, u.full_name, u.username,u.email, e.phone,
    d.name AS department, COALESCE(p.name,e.job_title) AS position, e.employment_type, e.status,
    to_char(e.start_date,'YYYY-MM-DD') AS start_date, s.name AS shift, e.experience_summary,
    to_char((now() AT TIME ZONE $2)::date,'YYYY-MM-DD') AS today
    FROM employees e JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id
    LEFT JOIN positions p ON p.id=e.position_id JOIN shifts s ON s.id=e.shift_id WHERE e.user_id=$1`,
  [req.user.id, profileTimeZone]);
  if (!r) throw missing();
  res.json({ employeeCode: r.employee_code, fullName: r.full_name, username:r.username,email: r.email, phone: r.phone,
    department: r.department, position: r.position, employmentType: r.employment_type, status: r.status,
    startDate: r.start_date, shift: r.shift, experienceSummary: r.experience_summary, today: r.today });
}));
router.get('/positions', validate(pageSchema, 'query'), wrap(async (req, res) => {
  const { rows: [e] } = await query('SELECT id FROM employees WHERE user_id=$1', [req.user.id]);
  if (!e) throw missing();
  const { rows } = await query(`SELECT id, department_name AS department, position_name AS position,
    to_char(recorded_at AT TIME ZONE $4,'YYYY-MM-DD') AS "recordedOn", is_baseline AS baseline
    FROM employee_position_history WHERE employee_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT $2 OFFSET $3`,
  [e.id, req.query.pageSize, pageOffset(req.query), profileTimeZone]);
  const { rows: [count] } = await query('SELECT count(*)::int AS total FROM employee_position_history WHERE employee_id=$1', [e.id]);
  res.json(pageResult(rows.map(r => ({ ...r, id: Number(r.id) })), req.query, count.total));
}));
router.put('/experience', validate({ experienceSummary: v.string({ required: true, max: 5000, nullable: true }) }), wrap(async (req, res) => {
  const saved = await withTransaction(async db => {
    const { rows: [e] } = await db.query('SELECT id,experience_summary FROM employees WHERE user_id=$1 FOR UPDATE', [req.user.id]);
    if (!e) throw missing();
    const value = req.body.experienceSummary ?? '';
    if (value !== e.experience_summary) {
      await db.query('UPDATE employees SET experience_summary=$2 WHERE id=$1', [e.id, value]);
      await audit(db, { actorId: req.user.id, action: 'employee.experience.update', entityType: 'employee', entityId: e.id,
        details: { changed: true } });
    }
    return { experienceSummary: value };
  });
  res.json(saved);
}));
const profileTimeZone = config.company.timezone;
export default router;
