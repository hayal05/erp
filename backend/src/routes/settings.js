import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { companyDate } from '../services/attendance.js';
import { setClause } from '../services/sql.js';
import { translateDbError, validationError } from '../services/dbErrors.js';
import { holidayCreate, holidayListQuery, holidayUpdate, idParams } from '../services/hrSchemas.js';

// Company settings for HR (spec 8, task 3.7), mounted at /api/settings. Holidays live here; the working days of each
// schedule are the shifts API (/api/shifts, `workDays`). Both feed the leave day count (services/workdays.js).
// A holiday change only affects requests made AFTER it: a request keeps the day count it was created with (3.1 decision).
const router = Router();
router.use(noStore, requireHr);

const SELECT = `SELECT id, to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name FROM holidays`;
const toHoliday = (r) => ({ id: Number(r.id), date: r.holiday_date, name: r.name });
const findHoliday = async (db, id) => { const { rows: [r] } = await db.query(`${SELECT} WHERE id = $1`, [id]); return r ? toHoliday(r) : null; };
const notFound = () => new HttpError(404, 'Holiday not found', 'not_found');
// Same calendar the leave API accepts (a leave request is limited to 2000-2100 too), so a holiday can never fall outside it.
const checkYear = (date) => { if (date && (date < '2000-01-01' || date > '2100-12-31')) throw validationError({ date: 'Choose a date between 2000 and 2100' }); };

// GET /holidays?year= -> { year, items } (one calendar year, by date; default: the current year in the company time zone)
router.get('/holidays', validate(holidayListQuery, 'query'), wrap(async (req, res) => {
  const year = req.query.year ?? Number(companyDate().slice(0, 4));
  const { rows } = await query(`${SELECT} WHERE holiday_date BETWEEN make_date($1::int, 1, 1) AND make_date($1::int, 12, 31) ORDER BY holiday_date`, [year]);
  res.json({ year, items: rows.map(toHoliday) });
}));

router.post('/holidays', validate(holidayCreate), wrap(async (req, res) => {
  const { date, name } = req.body;
  checkYear(date);
  const created = await withTransaction(async (db) => {
    const { rows: [row] } = await db.query('INSERT INTO holidays (holiday_date, name) VALUES ($1, $2) RETURNING id', [date, name]);
    await audit(db, { actorId: req.user.id, action: 'holiday.create', entityType: 'holiday', entityId: row.id, details: { date, name } });
    return findHoliday(db, row.id);
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

router.patch('/holidays/:id', validate(idParams, 'params'), validate(holidayUpdate), wrap(async (req, res) => {
  const { id } = req.params, data = req.body;
  if (!Object.keys(data).length) throw new HttpError(400, 'No changes supplied', 'validation', { fields: { _: 'Provide at least one field to change' } });
  checkYear(data.date);
  const updated = await withTransaction(async (db) => {
    await db.query('SELECT 1 FROM holidays WHERE id = $1 FOR UPDATE', [id]);
    const before = await findHoliday(db, id);
    if (!before) throw notFound();
    const { sets, params } = setClause({ date: 'holiday_date', name: 'name' }, data);
    await db.query(`UPDATE holidays SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]);
    const after = await findHoliday(db, id);
    const changes = diffFields(before, after, Object.keys(data));
    if (Object.keys(changes).length) await audit(db, { actorId: req.user.id, action: 'holiday.update', entityType: 'holiday', entityId: id, details: { changes } });
    return after;
  }).catch((err) => { throw translateDbError(err); });
  res.json(updated);
}));

// A holiday is a setting, not history (leave requests store their own day counts), so it can be deleted outright. Audited.
router.delete('/holidays/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  await withTransaction(async (db) => {
    const cur = await findHoliday(db, req.params.id);
    if (!cur) throw notFound();
    await db.query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
    await audit(db, { actorId: req.user.id, action: 'holiday.delete', entityType: 'holiday', entityId: req.params.id, details: { date: cur.date, name: cur.name } });
  });
  res.sendStatus(204);
}));

export default router;
