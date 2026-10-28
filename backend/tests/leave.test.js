// Task 3.3: employee leave API (types, balances, requests, cancel). DB tests need Postgres; the pure ones always run.
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
const { checkLeaveDates, shapeBalance } = await import('../src/services/leave.js');

// ---- pure rules
test('checkLeaveDates: ordered, same calendar year', () => {
  assert.deepEqual(checkLeaveDates('2026-11-02', '2026-11-02'), {});
  assert.deepEqual(checkLeaveDates('2026-01-01', '2026-12-31'), {});
  assert.deepEqual(Object.keys(checkLeaveDates('2026-11-03', '2026-11-02')), ['endDate']);
  assert.match(checkLeaveDates('2026-12-30', '2027-01-02').endDate, /one calendar year/);
});

test('shapeBalance: remaining = entitled + adjusted - used - pending; unlimited types have no remaining', () => {
  const row = { id: '1', code: 'annual', name: 'Annual leave', is_paid: true, has_balance: true, entitled: 16, adjusted: -2, used: '3', pending: 4 };
  assert.deepEqual(shapeBalance(row), { leaveTypeId: 1, code: 'annual', name: 'Annual leave', isPaid: true, hasBalance: true,
    entitled: 16, adjusted: -2, total: 14, used: 3, pending: 4, remaining: 7 });
  assert.equal(shapeBalance({ ...row, has_balance: false }).remaining, null);
});

// ---- API
const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
const OTHER = { email: 'other@natra.test', password: 'other-password-123' };
let empId, otherId, shiftId, annual, sick, unpaid;
const typeId = async (code) => Number((await query('SELECT id FROM leave_types WHERE code = $1', [code])).rows[0].id);

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  shiftId = (await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`)).rows[0].id; // Mon-Fri
  const ids = [];
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee', 'E-1'], [OTHER, 'Olu Other', 'employee', 'E-2']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.email, name, await hashPassword(c.password), role]);
    if (code) ids.push((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3) RETURNING id`, [code, u.id, shiftId])).rows[0].id);
  }
  [empId, otherId] = ids.map(Number);
  [annual, sick, unpaid] = [await typeId('annual'), await typeId('sick'), await typeId('unpaid')];
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear();
  if (skip) return;
  await query('DELETE FROM leave_requests'); await query('DELETE FROM leave_balances'); await query('DELETE FROM holidays');
  await query(`UPDATE employees SET status = 'active'`);
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

// 2026-11-02 is a Monday. Mon-Fri shift => 02..06 = 5 days; the weekend 07-08 = 0.
const body = (o = {}) => ({ leaveTypeId: annual, startDate: '2026-11-02', endDate: '2026-11-06', reason: 'Family visit', ...o });
const insert = (employeeId, typeIdValue, start, end, days, status = 'pending') => query(
  `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status, decided_at, decision_remarks)
   VALUES ($1,$2,$3,$4,$5,'seed',$6, CASE WHEN $6 IN ('approved','rejected') THEN now() END, CASE WHEN $6 = 'rejected' THEN 'no' END) RETURNING id`,
  [employeeId, typeIdValue, start, end, days, status]);
const balanceOf = async (client, code, year = '') => (await client.get(`/api/leave/balances${year}`)).body.items.find((i) => i.code === code);

test('anonymous gets 401 and HR gets 403 on every leave route', { skip }, async () => {
  const request = (await import('supertest')).default;
  const hr = await signIn(app, HR);
  for (const [method, url] of [['get', '/api/leave/types'], ['get', '/api/leave/balances'], ['get', '/api/leave/requests'],
    ['post', '/api/leave/requests'], ['post', '/api/leave/requests/1/cancel']]) {
    assert.equal((await request(app)[method](url).send({})).status, 401, `anonymous ${method} ${url}`);
    const res = method === 'get' ? await hr.get(url) : await hr[method](url).send(body());
    assert.equal(res.status, 403, `hr ${method} ${url}`);
    assert.equal(errorCode(res), 'forbidden');
  }
});

test('types: the four spec types, never cached', { skip }, async () => {
  const emp = await signIn(app, EMP);
  const res = await emp.get('/api/leave/types');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body.items.map((t) => t.code), ['annual', 'sick', 'personal', 'unpaid']);
  assert.deepEqual(res.body.items.find((t) => t.code === 'unpaid'), { id: unpaid, code: 'unpaid', name: 'Unpaid leave', isPaid: false, hasBalance: false });
});

test('balances: type defaults without a row, HR row and adjustment when present, used/pending from requests, per year', { skip }, async () => {
  const emp = await signIn(app, EMP);
  assert.deepEqual(await balanceOf(emp, 'annual', '?year=2026'), { leaveTypeId: annual, code: 'annual', name: 'Annual leave', isPaid: true, hasBalance: true,
    entitled: 16, adjusted: 0, total: 16, used: 0, pending: 0, remaining: 16 });
  await query(`INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days, adjusted_days) VALUES ($1,$2,2026,20,-2)`, [empId, annual]);
  await insert(empId, annual, '2026-03-02', '2026-03-04', 3, 'approved');
  await insert(empId, annual, '2026-04-06', '2026-04-07', 2, 'pending');
  await insert(empId, annual, '2026-05-04', '2026-05-04', 1, 'rejected');
  await insert(empId, annual, '2026-06-01', '2026-06-01', 1, 'cancelled');
  await insert(empId, annual, '2027-01-04', '2027-01-04', 1, 'approved'); // another year
  await insert(otherId, annual, '2026-03-02', '2026-03-06', 5, 'approved'); // another person
  const b = await balanceOf(emp, 'annual', '?year=2026');
  assert.deepEqual([b.entitled, b.adjusted, b.total, b.used, b.pending, b.remaining], [20, -2, 18, 3, 2, 13]);
  assert.equal((await balanceOf(emp, 'annual', '?year=2027')).used, 1);
  assert.equal((await balanceOf(emp, 'annual', '?year=2027')).entitled, 16); // no row for 2027: default
  assert.equal((await balanceOf(emp, 'unpaid', '?year=2026')).remaining, null);
  assert.equal((await emp.get('/api/leave/balances?year=1999')).status, 400);
  assert.match(String((await emp.get('/api/leave/balances')).body.year), /^20\d\d$/); // default = current company year
});

test('create: days are counted by the server (work days minus holidays), the request is pending, a sent "days" is ignored', { skip }, async () => {
  const emp = await signIn(app, EMP);
  await query(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-11-04', 'Mid-week holiday')`);
  const res = await emp.post('/api/leave/requests').send({ ...body(), days: 99, status: 'approved', employeeId: otherId });
  assert.equal(res.status, 201);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual({ ...res.body, id: undefined, createdAt: undefined },
    { id: undefined, leaveTypeId: annual, leaveType: 'annual', leaveTypeName: 'Annual leave', startDate: '2026-11-02', endDate: '2026-11-06',
      days: 4, reason: 'Family visit', status: 'pending', decisionRemarks: null, decidedAt: null, createdAt: undefined });
  const { rows } = await query('SELECT employee_id, days, status FROM leave_requests WHERE id = $1', [res.body.id]);
  assert.deepEqual([Number(rows[0].employee_id), rows[0].days, rows[0].status], [empId, 4, 'pending']); // always the signed-in user
  const audited = await query(`SELECT details FROM audit_logs WHERE action = 'leave.request' AND entity_id = $1`, [String(res.body.id)]);
  assert.equal(audited.rows.length, 1);
  assert.equal(audited.rows[0].details.days, 4);
});

test('create: validation (fields, order, one year, no working days, unknown type)', { skip }, async () => {
  const emp = await signIn(app, EMP);
  const post = (o) => emp.post('/api/leave/requests').send(o);
  assert.deepEqual(fieldsOf(await post({})), ['endDate', 'leaveTypeId', 'reason', 'startDate']);
  assert.deepEqual(fieldsOf(await post(body({ reason: '  ' }))), ['reason']);
  assert.deepEqual(fieldsOf(await post(body({ startDate: '2026-02-30' }))), ['startDate']);
  const backwards = await post(body({ startDate: '2026-11-06', endDate: '2026-11-02' }));
  assert.equal(backwards.status, 400); assert.deepEqual(fieldsOf(backwards), ['endDate']);
  assert.deepEqual(fieldsOf(await post(body({ startDate: '2026-12-30', endDate: '2027-01-04' }))), ['endDate']);
  const weekend = await post(body({ startDate: '2026-11-07', endDate: '2026-11-08' }));
  assert.equal(weekend.status, 400); assert.deepEqual(fieldsOf(weekend), ['startDate']);
  await query(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-11-02', 'Holiday')`);
  assert.equal((await post(body({ startDate: '2026-11-02', endDate: '2026-11-02' }))).status, 400); // a holiday alone costs nothing
  const unknown = await post(body({ leaveTypeId: 9999 }));
  assert.equal(unknown.status, 400); assert.deepEqual(fieldsOf(unknown), ['leaveTypeId']);
  assert.equal((await query('SELECT count(*)::int AS n FROM leave_requests')).rows[0].n, 0);
});

test('overlap: pending and approved leave block, cancelled/rejected/other people/adjacent days do not', { skip }, async () => {
  const emp = await signIn(app, EMP);
  await query(`INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days) VALUES ($1,$2,2026,100)`, [empId, annual]); // balance is not what this test is about
  await insert(empId, annual, '2026-11-09', '2026-11-13', 5, 'approved');
  await insert(otherId, annual, '2026-11-16', '2026-11-20', 5, 'approved');
  await insert(empId, sick, '2026-11-23', '2026-11-27', 5, 'cancelled');
  await insert(empId, sick, '2026-11-30', '2026-12-04', 5, 'rejected');
  const post = (start, end, o = {}) => emp.post('/api/leave/requests').send(body({ startDate: start, endDate: end, ...o }));
  const clash = await post('2026-11-13', '2026-11-16'); // touches the approved week on Friday 13th
  assert.equal(clash.status, 409); assert.equal(errorCode(clash), 'leave_overlap'); assert.deepEqual(fieldsOf(clash), ['startDate']);
  assert.match(clash.body.error.message, /approved leave from 2026-11-09 to 2026-11-13/);
  assert.equal((await post('2026-11-10', '2026-11-10', { leaveTypeId: unpaid })).status, 409); // any type
  assert.equal((await post('2026-11-02', '2026-11-06')).status, 201);  // the week before
  assert.equal((await post('2026-11-04', '2026-11-04')).status, 409);  // now overlaps my own PENDING one
  assert.equal((await post('2026-11-16', '2026-11-20')).status, 201);  // same days as someone else's leave
  assert.equal((await post('2026-11-23', '2026-11-27')).status, 201);  // cancelled one is gone
  assert.equal((await post('2026-11-30', '2026-12-04')).status, 201); // rejected one is gone
});

test('balance: over-balance is refused, the exact remainder is allowed, pending/approved/adjustments all count, unpaid is unlimited', { skip }, async () => {
  const emp = await signIn(app, EMP);
  const post = (start, end, o = {}) => emp.post('/api/leave/requests').send(body({ startDate: start, endDate: end, ...o }));
  // 2026-11-02 .. 2026-11-24 = 17 working days; annual default is 16
  const over = await post('2026-11-02', '2026-11-24');
  assert.equal(over.status, 409); assert.equal(errorCode(over), 'insufficient_balance'); assert.deepEqual(fieldsOf(over), ['leaveTypeId']);
  assert.deepEqual([over.body.error.details.remaining, over.body.error.details.requested], [16, 17]);
  assert.equal((await post('2026-11-02', '2026-11-23')).status, 201); // 16 days exactly
  assert.equal((await balanceOf(emp, 'annual')).remaining, 0);
  assert.equal((await post('2026-12-01', '2026-12-01')).status, 409);  // nothing left, because the pending 16 count
  await query(`UPDATE leave_requests SET status = 'approved', decided_at = now()`);
  assert.equal((await post('2026-12-01', '2026-12-01')).status, 409);  // approved still counts
  await query(`INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days, adjusted_days) VALUES ($1,$2,2026,16,2)`, [empId, annual]);
  assert.equal((await post('2026-12-01', '2026-12-02')).status, 201);  // HR added 2 days
  assert.equal((await post('2026-12-03', '2026-12-03')).status, 409);
  assert.equal((await post('2026-12-07', '2026-12-31', { leaveTypeId: unpaid })).status, 201); // unpaid has no balance
  assert.equal((await post('2026-12-07', '2026-12-31', { leaveTypeId: sick })).status, 409);   // 18 days of sick (default 10)
  // balances are per year: next year starts fresh
  assert.equal((await post('2027-01-04', '2027-01-08')).status, 201);
});

test('two simultaneous requests cannot overspend the balance or overlap', { skip }, async () => {
  const emp = await signIn(app, EMP);
  const post = (start, end) => emp.post('/api/leave/requests').send(body({ startDate: start, endDate: end }));
  // 10 days each against 16: only one fits
  const [a, b] = await Promise.all([post('2026-09-07', '2026-09-18'), post('2026-10-05', '2026-10-16')]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal((await query('SELECT count(*)::int AS n FROM leave_requests')).rows[0].n, 1);
  // the same days twice: only one is created
  const [c, d] = await Promise.all([post('2026-11-02', '2026-11-03'), post('2026-11-03', '2026-11-04')]);
  assert.deepEqual([c.status, d.status].sort(), [201, 409]);
});

test('cancel: own pending only; frees the balance; someone else\'s id is 404; approved/cancelled are 409', { skip }, async () => {
  const emp = await signIn(app, EMP);
  const created = (await emp.post('/api/leave/requests').send(body())).body;
  assert.equal((await balanceOf(emp, 'annual')).pending, 5);
  const theirs = Number((await insert(otherId, annual, '2026-12-07', '2026-12-08', 2)).rows[0].id);
  assert.equal((await emp.post(`/api/leave/requests/${theirs}/cancel`).send({})).status, 404);
  assert.equal((await query('SELECT status FROM leave_requests WHERE id = $1', [theirs])).rows[0].status, 'pending');
  const res = await emp.post(`/api/leave/requests/${created.id}/cancel`).send({});
  assert.equal(res.status, 200); assert.equal(res.body.status, 'cancelled');
  assert.equal((await balanceOf(emp, 'annual')).pending, 0);
  assert.equal((await emp.post(`/api/leave/requests/${created.id}/cancel`).send({})).status, 409);
  const approved = Number((await insert(empId, annual, '2026-12-14', '2026-12-15', 2, 'approved')).rows[0].id);
  const refused = await emp.post(`/api/leave/requests/${approved}/cancel`).send({});
  assert.equal(refused.status, 409); assert.equal(errorCode(refused), 'not_pending');
  assert.equal((await emp.post('/api/leave/requests/99999/cancel').send({})).status, 404);
  assert.equal((await emp.post('/api/leave/requests/abc/cancel').send({})).status, 400);
  assert.equal((await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'leave.cancel' AND entity_id = $1`, [String(created.id)])).rows[0].n, 1);
});

test('list: only my own requests, newest first, paginated and filtered', { skip }, async () => {
  const emp = await signIn(app, EMP);
  await insert(empId, annual, '2026-03-02', '2026-03-03', 2, 'approved');
  await insert(empId, sick, '2026-05-04', '2026-05-04', 1, 'pending');
  await insert(empId, annual, '2027-01-04', '2027-01-04', 1, 'pending');
  await insert(otherId, annual, '2026-06-01', '2026-06-02', 2, 'pending');
  const all = await emp.get('/api/leave/requests');
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3);
  assert.deepEqual(all.body.items.map((i) => i.startDate), ['2027-01-04', '2026-05-04', '2026-03-02']);
  assert.equal(all.body.items[1].leaveType, 'sick');
  const paged = await emp.get('/api/leave/requests?page=2&pageSize=2');
  assert.deepEqual([paged.body.items.length, paged.body.total, paged.body.page], [1, 3, 2]);
  assert.equal((await emp.get('/api/leave/requests?status=pending')).body.total, 2);
  assert.equal((await emp.get('/api/leave/requests?year=2026')).body.total, 2);
  assert.equal((await emp.get('/api/leave/requests?status=weird')).status, 400);
});

test('an inactive employee, or a login with no employee record, is refused', { skip }, async () => {
  const emp = await signIn(app, EMP);
  await query(`UPDATE employees SET status = 'inactive' WHERE id = $1`, [empId]);
  const res = await emp.post('/api/leave/requests').send(body());
  assert.equal(res.status, 403); assert.equal(errorCode(res), 'employee_inactive');
  assert.equal((await emp.get('/api/leave/balances')).status, 403);
  await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('norec@natra.test','No Record',$1,'employee')`, [await hashPassword('norec-password-123')]);
  const norec = await signIn(app, { email: 'norec@natra.test', password: 'norec-password-123' });
  assert.equal(errorCode(await norec.post('/api/leave/requests').send(body())), 'no_employee_record');
});

// ---- task 3.9: leave-aware attendance, end to end through the API (task 3.8 rules)
// Request -> HR approves -> the days show as "On approved leave" in the HR attendance list; rejected leave shows nothing.
test('approved leave shows as on_leave in the HR attendance list (working days only, holidays skipped); rejected leave does not', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  await query(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-11-04', 'Mid-week holiday')`);
  const made = await emp.post('/api/leave/requests').send(body()); // Mon 2 - Fri 6 Nov, minus the holiday = 4 days
  assert.equal(made.status, 201);
  assert.equal(made.body.days, 4);
  const list = (client, extra = '') => client.get(`/api/attendance-records?employeeId=${empId}&status=on_leave&pageSize=50${extra}`);
  assert.equal((await list(hr)).body.total, 0); // pending leave writes nothing

  assert.equal((await hr.post(`/api/leave-admin/requests/${made.body.id}/approve`).send({})).status, 200);
  const res = await list(hr);
  assert.deepEqual(res.body.items.map((r) => r.workDate).sort(), ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06']);
  assert.ok(res.body.items.every((r) => r.status === 'on_leave' && r.checkInAt === null && r.lateMinutes === 0));
  // Looking at the list again changes nothing (the fill is idempotent and never rewrites rows).
  assert.equal((await list(hr)).body.total, 4);

  const rejected = await emp.post('/api/leave/requests').send(body({ startDate: '2026-11-09', endDate: '2026-11-10' }));
  assert.equal((await hr.post(`/api/leave-admin/requests/${rejected.body.id}/reject`).send({ remarks: 'Busy week' })).status, 200);
  assert.equal((await list(hr)).body.total, 4);
  assert.equal((await hr.get(`/api/attendance-records?employeeId=${otherId}&status=on_leave`)).body.total, 0); // other people are unaffected
});

test('a scan is refused on approved leave even when no row was written yet (leave approved before this rule existed)', { skip }, async () => {
  const { classifyForEmployee } = await import('../src/services/attendanceStatus.js');
  await insert(empId, annual, '2026-11-02', '2026-11-02', 1, 'approved'); // inserted directly: no attendance row exists
  await assert.rejects(classifyForEmployee({ query }, { employeeId: empId, workDate: '2026-11-02' }), (e) => e.status === 409 && e.code === 'on_leave');
  assert.ok(['present', 'late'].includes((await classifyForEmployee({ query }, { employeeId: otherId, workDate: '2026-11-02' })).status)); // someone else is not blocked
});
