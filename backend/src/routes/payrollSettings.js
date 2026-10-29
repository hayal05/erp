import {approvalWrap as wrap} from '../middleware/approval.js';
import { attendancePolicy, parseAttendancePolicy } from '../services/payrollAttendance.js';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';

import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { audit, diffFields } from '../services/audit.js';
import { HttpError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { validationError, translateDbError } from '../services/dbErrors.js';
import { setClause } from '../services/sql.js';
import { idParams } from '../services/hrSchemas.js';
import { parseBracketTable, parseCalculationSettings, CALCULATION_KEYS, parseOtherTaxCreate, parseOtherTaxUpdate } from '../services/payrollSchemas.js';
import { validateBrackets, OTHER_TAX_BASES } from '../services/payrollEngine.js';

// Payroll settings for HR (spec 12-16), mounted at /api/payroll-settings. Task 4.5: income tax brackets; 4.6: pension rates and bases.
// Task 4.7: other taxes. Changes here only affect DRAFT payrolls: approval snapshots them (migration 004).
const router = Router();
router.use(noStore, requirePermission('payroll_settings.read'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('payroll_settings.manage')(req,res,next));

// bigint/numeric come back from pg as strings; the API speaks Numbers (minor units are far below 2^53, see money.js).
export const toBracket = (r) => ({ id: Number(r.id), fromMinor: Number(r.from_minor), toMinor: r.to_minor === null ? null : Number(r.to_minor),
  rate: Number(r.rate), fixedDeductionMinor: Number(r.fixed_deduction_minor) });
export const loadBrackets = async (db) => (await db.query('SELECT * FROM income_tax_brackets ORDER BY from_minor')).rows.map(toBracket);

// GET /brackets -> { items, problems }. `problems` is empty when the table is usable; payroll generation/approval refuse otherwise.
router.get('/brackets', wrap(async (req, res) => {
  const items = await loadBrackets({ query });
  res.json({ items, problems: validateBrackets(items) });
}));

// PUT /brackets { items: [{ fromMinor, toMinor|null, rate, fixedDeductionMinor }] } replaces the whole table atomically, only
// if it is valid: starts at 0, no gap, no overlap, last bracket open-ended (so every income matches exactly one bracket).
router.put('/brackets', wrap(async (req, res) => {
  const { items, errors } = parseBracketTable(req.body);
  if (errors) throw validationError(errors);
  const saved = await withTransaction(async (db) => {
    const before = await loadBrackets(db);
    await db.query('DELETE FROM income_tax_brackets');
    for (const b of items) {
      await db.query('INSERT INTO income_tax_brackets (from_minor, to_minor, rate, fixed_deduction_minor) VALUES ($1, $2, $3, $4)',
        [b.fromMinor, b.toMinor, b.rate, b.fixedDeductionMinor]);
    }
    const after = await loadBrackets(db);
    const strip = (list) => list.map(({ id, ...rest }) => rest);
    await audit(db, { actorId: req.user.id, action: 'payroll.brackets.replace', entityType: 'income_tax_brackets', details: { before: strip(before), after: strip(after) } });
    return after;
  }).catch((err) => { throw translateDbError(err); });
  res.json({ items: saved, problems: [] });
}));

// ---- Pension rates and bases (spec 13, 14), task 4.6. One row in payroll_settings (migration 004).
// Engine shape: the same keys payrollEngine.computeEntry reads from `settings`. numeric comes back from pg as a string.
export const toSettings = (r) => ({ taxBase: r.tax_base, pensionBase: r.pension_base, employeePensionRate: Number(r.employee_pension_rate),
  companyPensionRate: Number(r.company_pension_rate), roundingMode: r.rounding_mode, ...attendancePolicy(r) });
export const loadSettings = async (db, { lock = false } = {}) =>
  toSettings((await db.query(`SELECT * FROM payroll_settings${lock ? ' FOR UPDATE' : ''}`)).rows[0]);
const editable = ({ taxBase, pensionBase, employeePensionRate, companyPensionRate }) => ({ taxBase, pensionBase, employeePensionRate, companyPensionRate });

const COLUMNS = { taxBase: 'tax_base', pensionBase: 'pension_base', employeePensionRate: 'employee_pension_rate', companyPensionRate: 'company_pension_rate' };

router.get('/calculation', wrap(async (req, res) => {
  res.json(editable(await loadSettings({ query })));
}));

// PATCH /calculation { taxBase?, pensionBase?, employeePensionRate?, companyPensionRate? } -> the saved settings. Omitted = unchanged.
// A request that changes nothing writes nothing (no audit row). Draft payrolls pick the new values up when recalculated;
// approved ones keep their snapshot (migration 004), so this never alters history.
router.patch('/calculation', wrap(async (req, res) => {
  const { changes, errors } = parseCalculationSettings(req.body);
  if (errors) throw validationError(errors);
  const saved = await withTransaction(async (db) => {
    const before = editable(await loadSettings(db, { lock: true }));
    const diff = diffFields(before, { ...before, ...changes }, CALCULATION_KEYS);
    const keys = Object.keys(diff);
    if (keys.length === 0) return before;
    // Column names come from the fixed map above, never from the request.
    const set = keys.map((k, i) => `${COLUMNS[k]} = $${i + 1}`).join(', ');
    await db.query(`UPDATE payroll_settings SET ${set}`, keys.map((k) => changes[k]));
    await audit(db, { actorId: req.user.id, action: 'payroll.settings.update', entityType: 'payroll_settings', details: { changes: diff } });
    return editable(await loadSettings(db));
  }).catch((err) => { throw translateDbError(err); });
  res.json(saved);
}));

// ---- Other taxes (spec 15), task 4.7. Tax = base x rate / 100 on a PREDEFINED base, summed into the "Other Tax" column.
// Engine shape: [{ id, name, rate, base, enabled }] (payrollEngine ignores disabled ones). Like every setting here, a change
// only affects DRAFT payrolls; approval snapshots the list (config_snapshot), so deleting a tax never touches history.
export const toOtherTax = (r) => ({ id: Number(r.id), name: r.name, rate: Number(r.rate), base: r.base, enabled: r.enabled });
export const loadOtherTaxes = async (db) => (await db.query('SELECT * FROM other_taxes ORDER BY lower(name), id')).rows.map(toOtherTax);
const findOtherTax = async (db, id, { lock = false } = {}) => {
  const { rows: [r] } = await db.query(`SELECT * FROM other_taxes WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return r ? toOtherTax(r) : null;
};
const taxNotFound = () => new HttpError(404, 'Other tax not found', 'not_found');
// Runs a pure parser (payrollSchemas.js) as middleware: bad input -> 400 with field names; success replaces req.body by the cleaned copy.
const parsed = (parser) => (req, res, next) => {
  const { value, errors } = parser(req.body);
  if (errors) return next(validationError(errors));
  req.body = value;
  next();
};
const OTHER_TAX_COLUMNS = { name: 'name', rate: 'rate', base: 'base', enabled: 'enabled' };

// GET /other-taxes -> { items, bases }. `bases` is the fixed list a tax may use (the UI's dropdown); anything else is refused.
router.get('/other-taxes', wrap(async (req, res) => {
  res.json({ items: await loadOtherTaxes({ query }), bases: OTHER_TAX_BASES });
}));

// POST /other-taxes { name, rate, base, enabled? } -> 201 the new tax. Name is unique (case-insensitive): 409 on `name`.
router.post('/other-taxes', parsed(parseOtherTaxCreate), wrap(async (req, res) => {
  const { name, rate, base, enabled } = req.body;
  const created = await withTransaction(async (db) => {
    const { rows: [row] } = await db.query('INSERT INTO other_taxes (name, rate, base, enabled) VALUES ($1, $2, $3, $4) RETURNING id', [name, rate, base, enabled]);
    const tax = await findOtherTax(db, row.id);
    await audit(db, { actorId: req.user.id, action: 'payroll.other_tax.create', entityType: 'other_tax', entityId: tax.id, details: { name, rate, base, enabled } });
    return tax;
  }).catch((err) => { throw translateDbError(err); });
  res.status(201).json(created);
}));

// PATCH /other-taxes/:id { name?, rate?, base?, enabled? } -> the saved tax. Omitted = unchanged; a request that changes nothing
// returns 200 and writes no audit row (same rule as /calculation). Switching `enabled` off is how a tax is paused without losing it.
router.patch('/other-taxes/:id', validate(idParams, 'params'), parsed(parseOtherTaxUpdate), wrap(async (req, res) => {
  const { id } = req.params, data = req.body;
  const saved = await withTransaction(async (db) => {
    const before = await findOtherTax(db, id, { lock: true });
    if (!before) throw taxNotFound();
    const changes = diffFields(before, { ...before, ...data }, Object.keys(data));
    const keys = Object.keys(changes);
    if (keys.length === 0) return before;
    const { sets, params } = setClause(OTHER_TAX_COLUMNS, Object.fromEntries(keys.map((k) => [k, data[k]])));
    await db.query(`UPDATE other_taxes SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]);
    await audit(db, { actorId: req.user.id, action: 'payroll.other_tax.update', entityType: 'other_tax', entityId: id, details: { name: before.name, changes } });
    return findOtherTax(db, id);
  }).catch((err) => { throw translateDbError(err); });
  res.json(saved);
}));

// DELETE /other-taxes/:id -> 204. A tax is a setting, not history: payroll entries and the approval snapshot keep their own copies
// (no foreign keys to this table), so deleting never alters a payslip. Audited with the values it had.
router.delete('/other-taxes/:id', validate(idParams, 'params'), wrap(async (req, res) => {
  await withTransaction(async (db) => {
    const cur = await findOtherTax(db, req.params.id, { lock: true });
    if (!cur) throw taxNotFound();
    await db.query('DELETE FROM other_taxes WHERE id = $1', [req.params.id]);
    await audit(db, { actorId: req.user.id, action: 'payroll.other_tax.delete', entityType: 'other_tax', entityId: req.params.id, details: { name: cur.name, rate: cur.rate, base: cur.base, enabled: cur.enabled } });
  });
  res.sendStatus(204);
}));

router.get('/attendance-deductions', wrap(async (req, res) => {
  res.json(attendancePolicy((await query('SELECT * FROM payroll_settings')).rows[0]));
}));
router.patch('/attendance-deductions', wrap(async (req, res) => {
  const { value, errors } = parseAttendancePolicy(req.body);
  if (errors) throw validationError(errors);
  const saved = await withTransaction(async (db) => {
    const before = attendancePolicy((await db.query('SELECT * FROM payroll_settings FOR UPDATE')).rows[0]);
    const changes = diffFields(before, { ...before, ...value }, Object.keys(value));
    const columns = { absenceDeductionEnabled: 'absence_deduction_enabled', unpaidLeaveDeductionEnabled: 'unpaid_leave_deduction_enabled' };
    const keys = Object.keys(changes);
    if (keys.length) {
      await db.query(`UPDATE payroll_settings SET ${keys.map((k,i) => `${columns[k]}=$${i+1}`).join(', ')}`, keys.map((k) => value[k]));
      await audit(db, { actorId: req.user.id, action: 'payroll.attendance_policy.update', entityType: 'payroll_settings', details: { changes } });
    }
    return { ...before, ...value };
  });
  res.json(saved);
}));
export default router;
