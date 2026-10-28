// Task 3.4: HR leave API (queue, approve/reject, entitlements and adjustments). Needs Postgres.
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

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
const OTHER = { email: 'other@natra.test', password: 'other-password-123' };
let empId, otherId, hrUserId, annual, unpaid;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [shift] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  const ids = [];
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee', 'E-1'], [OTHER, 'Olu Other', 'employee', 'E-2']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [c.email, name, await hashPassword(c.password), role]);
    if (role === 'hr') hrUserId = Number(u.id);
    if (code) ids.push((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3) RETURNING id`, [code, u.id, shift.id])).rows[0].id);
  }
  [empId, otherId] = ids.map(Number);
  annual = Number((await query(`SELECT id FROM leave_types WHERE code = 'annual'`)).rows[0].id);
  unpaid = Number((await query(`SELECT id FROM leave_types WHERE code = 'unpaid'`)).rows[0].id);
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear();
  if (!skip) { await query('DELETE FROM leave_requests'); await query('DELETE FROM leave_balances'); }
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const insert = async (employeeId, type, start, end, days, status = 'pending') => Number((await query(
  `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status, decided_at, decision_remarks)
   VALUES ($1,$2,$3,$4,$5,'seed',$6, CASE WHEN $6 IN ('approved','rejected') THEN now() END, CASE WHEN $6 = 'rejected' THEN 'no' END) RETURNING id`,
  [employeeId, type, start, end, days, status])).rows[0].id);
const statusOf = async (id) => (await query('SELECT status FROM leave_requests WHERE id = $1', [id])).rows[0].status;
const audits = async (action, id) => (await query('SELECT actor_user_id, reason, details FROM audit_logs WHERE action = $1 AND entity_id = $2', [action, String(id)])).rows;

test('employees get 403 and anonymous 401 on every HR leave route; a locked tablet gets 423', { skip }, async () => {
  const request = (await import('supertest')).default;
  const emp = await signIn(app, EMP), hr = await signIn(app, HR);
  const routes = [['get', '/api/leave-admin/requests'], ['post', '/api/leave-admin/requests/1/approve'], ['post', '/api/leave-admin/requests/1/reject'],
    ['get', '/api/leave-admin/balances?employeeId=1'], ['post', '/api/leave-admin/balances']];
  for (const [m, url] of routes) {
    assert.equal((await request(app)[m](url).send({})).status, 401, `anon ${m} ${url}`);
    const res = m === 'get' ? await emp.get(url) : await emp[m](url).send({ reason: 'x', remarks: 'x' });
    assert.equal(res.status, 403, `employee ${m} ${url}`);
  }
  assert.equal((await hr.post('/api/qr/lock').send({})).status, 200);
  assert.equal((await hr.get('/api/leave-admin/requests')).status, 423);
  assert.equal((await hr.post('/api/leave-admin/balances').send({})).status, 423);
});

test('queue: everyone\'s requests, pending first, with employee names; filters and pages', { skip }, async () => {
  const hr = await signIn(app, HR);
  await insert(empId, annual, '2026-03-02', '2026-03-03', 2, 'approved');
  const p1 = await insert(otherId, annual, '2026-05-04', '2026-05-05', 2);
  await insert(empId, annual, '2027-01-04', '2027-01-04', 1);
  const res = await hr.get('/api/leave-admin/requests');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body.items.map((i) => i.status), ['pending', 'pending', 'approved']);
  assert.deepEqual([res.body.items[1].id, res.body.items[1].employeeName, res.body.items[1].employeeCode], [p1, 'Olu Other', 'E-2']);
  assert.equal((await hr.get(`/api/leave-admin/requests?employeeId=${empId}`)).body.total, 2);
  assert.equal((await hr.get('/api/leave-admin/requests?status=approved&year=2026')).body.total, 1);
  assert.equal((await hr.get('/api/leave-admin/requests?pageSize=1&page=3')).body.items.length, 1);
  assert.equal((await hr.get('/api/leave-admin/requests?status=bogus')).status, 400);
});

test('approve: sets status, decider, time; remarks optional; audited; balance moves from pending to used', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  const id = await insert(empId, annual, '2026-11-02', '2026-11-06', 5);
  assert.equal((await emp.get('/api/leave/balances?year=2026')).body.items[0].pending, 5);
  const res = await hr.post(`/api/leave-admin/requests/${id}/approve`).send({ remarks: 'Enjoy' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.status, res.body.decisionRemarks], ['approved', 'Enjoy']);
  assert.ok(res.body.decidedAt);
  const row = (await query('SELECT decided_by_user_id FROM leave_requests WHERE id = $1', [id])).rows[0];
  assert.equal(Number(row.decided_by_user_id), hrUserId);
  const b = (await emp.get('/api/leave/balances?year=2026')).body.items[0];
  assert.deepEqual([b.pending, b.used, b.remaining], [0, 5, 11]);
  const a = await audits('leave.approve', id);
  assert.deepEqual([a.length, Number(a[0].actor_user_id), a[0].reason], [1, hrUserId, 'Enjoy']);
  const noRemarks = await insert(empId, annual, '2026-12-07', '2026-12-07', 1);
  assert.equal((await hr.post(`/api/leave-admin/requests/${noRemarks}/approve`).send({})).status, 200);
});

test('reject: remarks are required; a rejection frees the balance and shows the employee why', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  const id = await insert(empId, annual, '2026-11-02', '2026-11-06', 5);
  for (const bad of [{}, { remarks: '  ' }, { remarks: 'no' }]) {
    const r = await hr.post(`/api/leave-admin/requests/${id}/reject`).send(bad);
    assert.equal(r.status, 400); assert.deepEqual(fieldsOf(r), ['remarks']);
  }
  assert.equal(await statusOf(id), 'pending');
  const res = await hr.post(`/api/leave-admin/requests/${id}/reject`).send({ remarks: 'Busy season' });
  assert.deepEqual([res.status, res.body.status, res.body.decisionRemarks], [200, 'rejected', 'Busy season']);
  assert.equal((await emp.get('/api/leave/balances?year=2026')).body.items[0].pending, 0);
  assert.equal((await emp.get('/api/leave/requests')).body.items[0].decisionRemarks, 'Busy season');
  assert.equal((await audits('leave.reject', id))[0].reason, 'Busy season');
});

test('a decided, cancelled or missing request cannot be decided again', { skip }, async () => {
  const hr = await signIn(app, HR);
  const done = await insert(empId, annual, '2026-11-02', '2026-11-02', 1, 'approved');
  const gone = await insert(empId, annual, '2026-11-03', '2026-11-03', 1, 'cancelled');
  for (const id of [done, gone]) {
    const r = await hr.post(`/api/leave-admin/requests/${id}/reject`).send({ remarks: 'Changed my mind' });
    assert.equal(r.status, 409); assert.equal(errorCode(r), 'not_pending');
  }
  assert.equal(await statusOf(done), 'approved');
  assert.equal((await hr.post('/api/leave-admin/requests/99999/approve').send({})).status, 404);
  assert.equal((await hr.post('/api/leave-admin/requests/abc/approve').send({})).status, 400);
});

test('approving cannot create overlapping approved leave (friendly check and the DB constraint)', { skip }, async () => {
  const hr = await signIn(app, HR);
  await insert(empId, annual, '2026-11-02', '2026-11-06', 5, 'approved');
  const clash = await insert(empId, annual, '2026-11-05', '2026-11-09', 3); // pending rows can overlap if legacy/seeded
  const r = await hr.post(`/api/leave-admin/requests/${clash}/approve`).send({});
  assert.equal(r.status, 409); assert.equal(errorCode(r), 'leave_overlap');
  assert.equal(await statusOf(clash), 'pending');
  // someone else's overlapping leave is fine
  const fine = await insert(otherId, annual, '2026-11-05', '2026-11-09', 3);
  assert.equal((await hr.post(`/api/leave-admin/requests/${fine}/approve`).send({})).status, 200);
  // two simultaneous approvals of overlapping requests: exactly one wins
  const a = await insert(empId, annual, '2026-12-07', '2026-12-09', 3), b = await insert(empId, annual, '2026-12-08', '2026-12-10', 3);
  const both = await Promise.all([a, b].map((id) => hr.post(`/api/leave-admin/requests/${id}/approve`).send({})));
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
});

test('balances: view per employee; set entitlement; adjust with a reason; row created from the default', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  assert.equal((await hr.get('/api/leave-admin/balances')).status, 400); // employeeId required
  const view = await hr.get(`/api/leave-admin/balances?employeeId=${empId}&year=2026`);
  assert.deepEqual([view.body.items.length, view.body.items[0].entitled], [4, 16]);
  const body = (o) => ({ employeeId: empId, leaveTypeId: annual, year: 2026, reason: 'Contract terms', ...o });
  const adj = await hr.post('/api/leave-admin/balances').send(body({ adjustDays: 3 })); // row created: default 16 + 3
  assert.equal(adj.status, 200);
  assert.deepEqual([adj.body.entitled, adj.body.adjusted, adj.body.total, adj.body.remaining], [16, 3, 19, 19]);
  const set = await hr.post('/api/leave-admin/balances').send(body({ entitledDays: 20, reason: 'Seniority' }));
  assert.deepEqual([set.body.entitled, set.body.adjusted, set.body.total], [20, 3, 23]);
  const down = await hr.post('/api/leave-admin/balances').send(body({ adjustDays: -5, reason: 'Carry-over correction' }));
  assert.deepEqual([down.body.adjusted, down.body.total], [-2, 18]); // adjustDays is a change, applied to 3
  assert.equal((await emp.get('/api/leave/balances?year=2026')).body.items[0].remaining, 18); // the employee sees it
  const log = await audits('leave.balance_adjust', `${empId}:${annual}:2026`);
  assert.equal(log.length, 3);
  assert.deepEqual(log[2].details.adjusted, { from: 3, to: -2 });
  assert.equal(log[2].reason, 'Carry-over correction');
});

test('balances: no reason, nothing to change, unpaid, unknown ids, negative total, or going below used are all refused and change nothing', { skip }, async () => {
  const hr = await signIn(app, HR);
  const body = (o) => ({ employeeId: empId, leaveTypeId: annual, year: 2026, reason: 'Fix', adjustDays: 1, ...o });
  const post = (o) => hr.post('/api/leave-admin/balances').send(body(o));
  for (const bad of [{ reason: undefined }, { reason: '   ' }, { reason: 'x' }]) {
    const r = await post(bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.deepEqual(fieldsOf(r), ['reason']);
  }
  assert.equal((await post({ adjustDays: undefined })).status, 400);       // neither entitlement nor adjustment
  assert.deepEqual(fieldsOf(await post({ leaveTypeId: unpaid })), ['leaveTypeId']);
  assert.deepEqual(fieldsOf(await post({ leaveTypeId: 9999 })), ['leaveTypeId']);
  assert.deepEqual(fieldsOf(await post({ employeeId: 9999 })), ['employeeId']);
  assert.equal((await post({ adjustDays: -17 })).status, 400);             // 16 - 17 < 0
  await insert(empId, annual, '2026-03-02', '2026-03-06', 5, 'approved');
  await insert(empId, annual, '2026-04-06', '2026-04-07', 2);
  const low = await post({ entitledDays: 6, adjustDays: undefined });      // 6 < 5 used + 2 pending
  assert.equal(low.status, 409); assert.equal(errorCode(low), 'below_used');
  assert.equal((await post({ entitledDays: 7, adjustDays: undefined })).status, 200); // exactly used + pending
  assert.equal((await query('SELECT count(*)::int AS n FROM leave_balances')).rows[0].n, 1);
  assert.equal((await query('SELECT entitled_days FROM leave_balances')).rows[0].entitled_days, 7);
});
