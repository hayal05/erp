import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { validate } from '../middleware/validate.js';
import { v } from '../middleware/validate.js';
import { validationError } from '../services/dbErrors.js';
import { loadPayrollCsv } from '../services/payrollCsv.js';
import { loadPayrollDetail } from '../services/payrollDetails.js';
import { parsePayment } from '../services/payrollPayment.js';
import { approvePeriod, markPeriodPaid } from '../services/payrollWorkflow.js';
import { parseEntryEdit, editDraftEntry } from '../services/payrollEdit.js';
import { idParams } from '../services/hrSchemas.js';
import { pageSchema, pageOffset } from '../services/sql.js';
import { loadSettings, loadBrackets, loadOtherTaxes } from './payrollSettings.js';
import { regenerateDraft, generateDraft, parsePeriodMonth, toPeriod, toEntry } from '../services/payrollDraft.js';
const router = Router();
router.use(noStore, requireHr);
// Creation and generation are one operation: no empty or partly generated period survives a failure.
router.post('/periods', wrap(async (req, res) => {
  const month = parsePeriodMonth(req.body?.month);
  const result = await withTransaction(async (db) => {
    // One MVCC snapshot for profiles, employee status and settings. Conflicting one-time consumption aborts with 409.
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const settings = await loadSettings(db, { lock: true });
    const brackets = await loadBrackets(db), otherTaxes = await loadOtherTaxes(db);
    return generateDraft(db, { month, actorId: req.user.id, settings, brackets, otherTaxes });
  }).catch((err) => {
    if (err.code === '23505' && err.constraint === 'payroll_periods_month_key') throw new HttpError(409, 'A payroll period already exists for this month', 'conflict');
    if (err.code === '40001' || err.code === '40P01') throw new HttpError(409, 'Payroll inputs changed during generation. Retry the request.', 'conflict');
    throw err;
  });
  res.status(201).json(result);
}));
router.post('/periods/:id/regenerate', validate(idParams, 'params'), wrap(async (req, res) => {
  const result = await withTransaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const settings = await loadSettings(db, { lock: true });
    const brackets = await loadBrackets(db), otherTaxes = await loadOtherTaxes(db);
    return regenerateDraft(db, { periodId: req.params.id, actorId: req.user.id, settings, brackets, otherTaxes });
  }).catch((err) => {
    if (err.code === '40001' || err.code === '40P01') throw new HttpError(409, 'Payroll inputs changed during regeneration. Reload and try again.', 'conflict');
    throw err;
  });
  res.json(result);
}));
router.get('/periods', validate({ ...pageSchema, month: v.string({ pattern: /^[1-9]\d{3}-(0[1-9]|1[0-2])$/, patternMessage: 'Use YYYY-MM' }) }, 'query'), wrap(async (req, res) => {
  const { page, pageSize } = req.query, offset = pageOffset(req.query);
  const month = req.query.month ? `${req.query.month}-01` : null;
  const { rows } = await query(`SELECT id, to_char(period_month, 'YYYY-MM') AS month, status FROM payroll_periods WHERE ($3::date IS NULL OR period_month=$3::date) ORDER BY period_month DESC LIMIT $1 OFFSET $2`, [pageSize, offset, month]);
  const { rows: [count] } = await query('SELECT count(*)::int AS total FROM payroll_periods WHERE ($1::date IS NULL OR period_month=$1::date)', [month]);
  res.json({ items: rows.map(toPeriod), total: count.total, page, pageSize });
}));
router.get('/periods/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  const { rows: [period] } = await query(`SELECT id, to_char(period_month, 'YYYY-MM') AS month, status, approved_at, approved_by_user_id, config_snapshot, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, paid_by_user_id FROM payroll_periods WHERE id = $1`, [req.params.id]);
  if (!period) throw new HttpError(404, 'Payroll period not found', 'not_found');
  res.json({ ...toPeriod(period), approvedAt: period.approved_at, approvedByUserId: period.approved_by_user_id == null ? null : Number(period.approved_by_user_id), configSnapshot: period.config_snapshot, paidOn: period.paid_on, paidByUserId: period.paid_by_user_id == null ? null : Number(period.paid_by_user_id) });
}));
router.get('/periods/:id/export.csv', validate(idParams, 'params'), wrap(async (req, res) => {
  const result = await withTransaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return loadPayrollCsv(db, req.params.id);
  });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.csv);
}));
router.get('/periods/:id/entries', validate(idParams, 'params'), validate(pageSchema, 'query'), wrap(async (req, res) => {
  const id = req.params.id, { page, pageSize } = req.query, offset = pageOffset(req.query);
  if (!(await query('SELECT 1 FROM payroll_periods WHERE id=$1', [id])).rowCount) throw new HttpError(404, 'Payroll period not found', 'not_found');
  const { rows } = await query('SELECT * FROM payroll_entries WHERE period_id=$1 ORDER BY employee_id LIMIT $2 OFFSET $3', [id, pageSize, offset]);
  const { rows: [count] } = await query('SELECT count(*)::int AS total FROM payroll_entries WHERE period_id=$1', [id]);
  res.json({ items: rows.map(toEntry), total: count.total, page, pageSize });
}));
router.get('/periods/:id/entries/:entryId', validate({ ...idParams, entryId: v.int({ required: true, min: 1 }) }, 'params'), wrap(async (req, res) => {
  const detail = await withTransaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return loadPayrollDetail(db, { periodId: req.params.id, entryId: req.params.entryId });
  });
  res.json(detail);
}));
router.patch('/periods/:id/entries/:entryId', validate({ ...idParams, entryId: v.int({ required: true, min: 1 }) }, 'params'), wrap(async (req, res) => {
  const { value: changes, errors } = parseEntryEdit(req.body);
  if (errors) throw validationError(errors);
  const result = await withTransaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const settings = await loadSettings(db, { lock: true });
    const brackets = await loadBrackets(db), otherTaxes = await loadOtherTaxes(db);
    return editDraftEntry(db, { periodId: req.params.id, entryId: req.params.entryId, changes, actorId: req.user.id, settings, brackets, otherTaxes });
  }).catch((err) => {
    if (err.code === '40001' || err.code === '40P01') throw new HttpError(409, 'Payroll inputs changed during recalculation. Retry the request.', 'conflict');
    throw err;
  });
  res.json(result);
}));
router.post('/periods/:id/approve', validate(idParams, 'params'), wrap(async (req, res) => {
  const result = await withTransaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const settings = await loadSettings(db, { lock: true });
    const brackets = await loadBrackets(db), otherTaxes = await loadOtherTaxes(db);
    return approvePeriod(db, { periodId: req.params.id, actorId: req.user.id, settings, brackets, otherTaxes });
  }).catch((err) => {
    if (err.code === '40001' || err.code === '40P01') throw new HttpError(409, 'Payroll inputs changed during approval. Review the draft and retry.', 'conflict');
    throw err;
  });
  res.json(result);
}));
router.post('/periods/:id/pay', validate(idParams, 'params'), wrap(async (req, res) => {
  const { value, errors } = parsePayment(req.body);
  if (errors) throw validationError(errors);
  const result = await withTransaction((db) => markPeriodPaid(db, { periodId: req.params.id, actorId: req.user.id, paidOn: value.paidOn })).catch((err) => {
    if (err.code === '40001' || err.code === '40P01') throw new HttpError(409, 'Payroll changed during payment recording. Reload the period and retry.', 'conflict');
    throw err;
  });
  res.json(result);
}));
export default router;
