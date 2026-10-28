// Task 3.7: holidays API (HR settings) and its effect on leave day counts. Needs Postgres.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');
const { hashPassword } = await import('../src/services/password.js');
const { companyDate } = await import('../src/services/attendance.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
let shiftId, annual;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  shiftId = Number((await query(`INSERT INTO shifts (name, start_time, end_time, work_days) VALUES ('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id`)).rows[0].id);
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee', 'E-1']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [c.email, name, await hashPassword(c.password), role]);
    if (code) await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3)`, [code, u.id, shiftId]);
  }
  annual = Number((await query(`SELECT id FROM leave_types WHERE code = 'annual'`)).rows[0].id);
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear();
  if (!skip) { await query('DELETE FROM leave_requests'); await query('DELETE FROM holidays'); await query(`UPDATE shifts SET work_days = '{1,2,3,4,5}'`); }
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const audits = async (action, id) => (await query('SELECT actor_user_id, details FROM audit_logs WHERE action = $1 AND entity_id = $2', [action, String(id)])).rows;

test('employees get 403 and anonymous 401 on every settings route; a locked tablet gets 423', { skip }, async () => {
  const request = (await import('supertest')).default;
  const emp = await signIn(app, EMP), hr = await signIn(app, HR);
  const routes = [['get', '/api/settings/holidays'], ['post', '/api/settings/holidays'], ['patch', '/api/settings/holidays/1'], ['delete', '/api/settings/holidays/1']];
  for (const [m, url] of routes) {
    assert.equal((await request(app)[m](url).send({})).status, 401, `anon ${m} ${url}`);
    const res = m === 'get' ? await emp.get(url) : await emp[m](url).send({ name: 'x', date: '2026-01-01' });
    assert.equal(res.status, 403, `employee ${m} ${url}`);
  }
  assert.equal((await hr.post('/api/qr/lock').send({})).status, 200);
  assert.equal((await hr.get('/api/settings/holidays')).status, 423);
  assert.equal((await hr.post('/api/settings/holidays').send({ date: '2026-01-01', name: 'x' })).status, 423);
});

test('create and list: by year, in date order, audited', { skip }, async () => {
  const hr = await signIn(app, HR);
  const b = await hr.post('/api/settings/holidays').send({ date: '2026-12-25', name: ' Christmas ' });
  assert.equal(b.status, 201);
  assert.deepEqual([b.body.date, b.body.name], ['2026-12-25', 'Christmas']);
  await hr.post('/api/settings/holidays').send({ date: '2026-01-07', name: 'Genna' });
  await hr.post('/api/settings/holidays').send({ date: '2027-01-01', name: 'Next year' });
  const list = await hr.get('/api/settings/holidays?year=2026');
  assert.equal(list.body.year, 2026);
  assert.deepEqual(list.body.items.map((h) => h.date), ['2026-01-07', '2026-12-25']);
  assert.deepEqual((await hr.get('/api/settings/holidays?year=2027')).body.items.map((h) => h.name), ['Next year']);
  assert.equal((await hr.get('/api/settings/holidays')).body.year, Number(companyDate().slice(0, 4))); // default: current company year
  const [a] = await audits('holiday.create', b.body.id);
  assert.deepEqual(a.details, { date: '2026-12-25', name: 'Christmas' });
});

test('create: one holiday per date (409 on date), impossible dates and blank names are refused', { skip }, async () => {
  const hr = await signIn(app, HR);
  await hr.post('/api/settings/holidays').send({ date: '2026-05-01', name: 'Labour Day' });
  const dup = await hr.post('/api/settings/holidays').send({ date: '2026-05-01', name: 'Again' });
  assert.equal(dup.status, 409);
  assert.deepEqual(fieldsOf(dup), ['date']);
  for (const body of [{ date: '2026-02-30', name: 'x' }, { date: 'tomorrow', name: 'x' }, { date: '2026-06-01', name: '  ' }, { date: '2026-06-01' }, { name: 'x' }, { date: '1999-12-31', name: 'x' }, { date: '2101-01-01', name: 'x' }]) {
    const res = await hr.post('/api/settings/holidays').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await hr.get('/api/settings/holidays?year=1999')).status, 400);
  assert.equal((await query('SELECT count(*)::int AS n FROM holidays')).rows[0].n, 1);
});

test('update: rename or move, audited with before/after; no change, unknown id and a taken date are refused', { skip }, async () => {
  const hr = await signIn(app, HR);
  const a = (await hr.post('/api/settings/holidays').send({ date: '2026-09-11', name: 'New Year' })).body;
  const b = (await hr.post('/api/settings/holidays').send({ date: '2026-09-27', name: 'Meskel' })).body;
  const res = await hr.patch(`/api/settings/holidays/${a.id}`).send({ name: 'Enkutatash', date: '2026-09-12' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.name, res.body.date], ['Enkutatash', '2026-09-12']);
  const [log] = await audits('holiday.update', a.id);
  assert.deepEqual(log.details.changes, { name: { from: 'New Year', to: 'Enkutatash' }, date: { from: '2026-09-11', to: '2026-09-12' } });
  assert.equal((await hr.patch(`/api/settings/holidays/${a.id}`).send({})).status, 400);
  assert.equal(errorCode(await hr.patch('/api/settings/holidays/99999').send({ name: 'x' })), 'not_found');
  const clash = await hr.patch(`/api/settings/holidays/${b.id}`).send({ date: '2026-09-12' });
  assert.equal(clash.status, 409);
  assert.deepEqual(fieldsOf(clash), ['date']);
  assert.equal((await hr.patch(`/api/settings/holidays/${b.id}`).send({ date: '2026-09-27' })).status, 200); // same value is fine
});

test('delete: removes the holiday, audited; unknown id is 404', { skip }, async () => {
  const hr = await signIn(app, HR);
  const h = (await hr.post('/api/settings/holidays').send({ date: '2026-03-02', name: 'Adwa' })).body;
  assert.equal((await hr.delete(`/api/settings/holidays/${h.id}`)).status, 204);
  assert.equal((await hr.get('/api/settings/holidays?year=2026')).body.items.length, 0);
  assert.equal((await hr.delete(`/api/settings/holidays/${h.id}`)).status, 404);
  assert.deepEqual((await audits('holiday.delete', h.id))[0].details, { date: '2026-03-02', name: 'Adwa' });
});

// Done-when: holiday changes affect day counts (and so do a schedule's working days). Mon 2 - Fri 6 Nov 2026.
test('holiday and working-day changes change the day count of the next leave request, never an existing one', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  const ask = async (start, end) => {
    const res = await emp.post('/api/leave/requests').send({ leaveTypeId: annual, startDate: start, endDate: end, reason: 'test' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((await emp.post(`/api/leave/requests/${res.body.id}/cancel`).send({})).status, 200);
    return res.body.days;
  };
  assert.equal(await ask('2026-11-02', '2026-11-06'), 5);

  const h = (await hr.post('/api/settings/holidays').send({ date: '2026-11-04', name: 'Midweek holiday' })).body;
  assert.equal(await ask('2026-11-02', '2026-11-06'), 4);                    // holiday added -> one day fewer
  await hr.patch(`/api/settings/holidays/${h.id}`).send({ date: '2026-11-08' }); // moved to a Sunday: no longer in the range
  assert.equal(await ask('2026-11-02', '2026-11-06'), 5);
  await hr.delete(`/api/settings/holidays/${h.id}`);

  assert.equal(await ask('2026-11-02', '2026-11-07'), 5);                    // Saturday is not a work day
  assert.equal((await hr.patch(`/api/shifts/${shiftId}`).send({ workDays: [1, 2, 3, 4, 5, 6] })).status, 200);
  assert.equal(await ask('2026-11-02', '2026-11-07'), 6);                    // now it is

  // An existing request keeps the days it was created with, even when a holiday is added afterwards.
  const kept = await emp.post('/api/leave/requests').send({ leaveTypeId: annual, startDate: '2026-11-16', endDate: '2026-11-17', reason: 'snapshot' });
  assert.equal(kept.body.days, 2);
  await hr.post('/api/settings/holidays').send({ date: '2026-11-16', name: 'Late holiday' });
  assert.equal((await query('SELECT days FROM leave_requests WHERE id = $1', [kept.body.id])).rows[0].days, 2);
});
