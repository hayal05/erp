// Task 6.2: the single function that writes salary_profiles. Needs Postgres (skipped without TEST_DATABASE_URL).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query, withTransaction } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { saveSalaryProfile, loadSalaryProfile } = await import('../src/services/salaryProfiles.js');

const VALUES = { basicMinor: 500000, allowanceMinor: 100000, allowanceTaxable: true, allowancePensionable: false, pensionApplies: true };
let empId, hrId;
const save = (values, extra = {}) => withTransaction((db) => saveSalaryProfile(db, { employeeId: empId, actorId: hrId, values, ...extra }));
const audits = async (action) => (await query('SELECT details FROM audit_logs WHERE action = $1 ORDER BY id', [action])).rows.map((r) => r.details);

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [s] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  const { rows: [hr] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('hr@x.test','HR','x','hr') RETURNING id`);
  const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('e@x.test','Emp','x','employee') RETURNING id`);
  empId = Number((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ('E-1',$1,'2026-01-05',$2) RETURNING id`, [u.id, s.id])).rows[0].id);
  hrId = Number(hr.id);
});
beforeEach(async () => { if (!skip) await query('TRUNCATE audit_logs, salary_profiles RESTART IDENTITY CASCADE'); });
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

test('saveSalaryProfile: first save creates the row and one create audit; the default state is unsaved', { skip }, async () => {
  assert.equal((await loadSalaryProfile({ query }, empId)).saved, false);
  const saved = await save(VALUES);
  assert.deepEqual([saved.saved, saved.basicMinor, saved.allowanceMinor, saved.allowancePensionable], [true, 500000, 100000, false]);
  const [details] = await audits('payroll.profile.create');
  assert.equal(details.employeeId, empId);
  assert.equal(details.changes.basicMinor.to, 500000);
  assert.equal('source' in details, false); // no marker unless a caller gives one
  assert.equal((await audits('payroll.profile.update')).length, 0);
});

test('saveSalaryProfile: saving the same values again writes nothing and audits nothing', { skip }, async () => {
  await save(VALUES);
  const before = (await query('SELECT updated_at FROM salary_profiles WHERE employee_id = $1', [empId])).rows[0].updated_at;
  await save(VALUES);
  assert.equal((await audits('payroll.profile.create')).length, 1);
  assert.equal((await audits('payroll.profile.update')).length, 0);
  assert.equal((await query('SELECT updated_at FROM salary_profiles WHERE employee_id = $1', [empId])).rows[0].updated_at.getTime(), before.getTime());
});

test('saveSalaryProfile: a change updates the row and audits only what changed', { skip }, async () => {
  await save(VALUES);
  await save({ ...VALUES, allowanceMinor: 120000 });
  const [details] = await audits('payroll.profile.update');
  assert.deepEqual(Object.keys(details.changes), ['allowanceMinor']);
  assert.deepEqual(details.changes.allowanceMinor, { from: 100000, to: 120000 });
});

test('saveSalaryProfile: the audit source marker is recorded only when a caller passes one', { skip }, async () => {
  await save(VALUES, { source: { type: 'position', positionId: 7 } });
  const [details] = await audits('payroll.profile.create');
  assert.deepEqual(details.source, { type: 'position', positionId: 7 });
});

test('saveSalaryProfile: an unknown employee is a 404 and nothing is written', { skip }, async () => {
  await assert.rejects(withTransaction((db) => saveSalaryProfile(db, { employeeId: 999999, actorId: hrId, values: VALUES })),
    (e) => e.status === 404 && e.code === 'not_found');
  assert.equal((await query('SELECT count(*)::int AS n FROM salary_profiles')).rows[0].n, 0);
  assert.equal((await query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n, 0);
});

test('saveSalaryProfile: a failure after the write rolls the profile back with it', { skip }, async () => {
  await assert.rejects(withTransaction(async (db) => { await saveSalaryProfile(db, { employeeId: empId, actorId: hrId, values: VALUES }); throw new Error('later step failed'); }), /later step failed/);
  assert.equal((await query('SELECT count(*)::int AS n FROM salary_profiles')).rows[0].n, 0);
  assert.equal((await query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n, 0);
});
