import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { default: request } = await import('supertest');
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { hashPassword } = await import('../src/services/password.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const PLAIN = { email: 'plain@natra.test', password: 'plain-password-123' }; // an employee login with no employee record
let hr;
let shiftId;
let n = 0;

const newEmployee = (o = {}) => {
  n += 1;
  return { gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study',employeeCode: `E${String(n).padStart(3, '0')}`, fullName: `Person ${n}`, username: `p${n}@natra.test`, email: `p${n}@natra.test`,
    startDate: '2026-02-01', password: 'initial-password-1', ...o };
};
const create = async (o) => { const res = await hr.post('/api/employees').send(newEmployee(o)); assert.equal(res.status, 201, JSON.stringify(res.body)); return res.body; };
const auditRows = async (action, entityId) =>
  (await query('SELECT * FROM audit_logs WHERE action = $1 AND entity_id = $2 ORDER BY id', [action, String(entityId)])).rows;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  loginLimits.ip.clear(); loginLimits.pair.clear();
  for (const [c, name, role] of [[HR, 'Hana HR', 'hr'], [PLAIN, 'Plain User', 'employee']]) {
    await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, $4)`, [c.email, name, await hashPassword(c.password), role]);
  }
  // This legacy role='hr' fixture exercises immediate General Admin CRUD.
  // New HR grants require a reviewer, covered by employeePersonalDetailsEmbedded.test.js.
  await query("INSERT INTO access_grants(user_id,access_role,granted_by_user_id) SELECT id,'admin',id FROM users WHERE email=$1",[HR.email]);
  shiftId = Number((await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Standard', '09:00', '17:00') RETURNING id`)).rows[0].id);
  hr = await signIn(app, HR);
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

test('anonymous users get 401 and employees get 403 on every employee route', { skip }, async () => {
  const emp = await signIn(app, PLAIN);
  const send = (client, method, url) => (method === 'get' ? client.get(url) : client[method](url).send({}));
  const routes = [['get', '/api/employees'], ['get', '/api/employees/1'], ['post', '/api/employees'], ['patch', '/api/employees/1'],
    ['post', '/api/employees/1/deactivate'], ['post', '/api/employees/1/activate']];
  for (const [method, url] of routes) {
    const anon = await send(request(app), method, url);
    assert.equal(anon.status, 401, `${method} ${url}`);
    const res = await send(emp, method, url);
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(errorCode(res), 'forbidden');
  }
});

test('a locked HR session cannot reach employee data (423)', { skip }, async () => {
  const tablet = await signIn(app, HR); // a second, newer HR session
  await query(`UPDATE sessions SET locked = true, locked_at = now() WHERE id = (
    SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1 ORDER BY s.created_at DESC LIMIT 1)`, [HR.email]);
  const res = await tablet.get('/api/employees');
  assert.equal(res.status, 423);
  assert.equal(errorCode(res), 'screen_locked');
  assert.equal((await hr.get('/api/employees')).status, 200); // the other HR session is unaffected
});

test('create: 201, full record, working login, no secrets in the response or audit log', { skip }, async () => {
  const body = newEmployee({ phone: '+251 911 000 000', jobTitle: 'Accountant' });
  const res = await hr.post('/api/employees').send(body);
  assert.equal(res.status, 201);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(res.body.employeeCode, body.employeeCode);
  assert.equal(res.body.fullName, body.fullName);
  assert.equal(res.body.startDate, '2026-02-01');
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.employmentType, 'full_time');
  assert.equal(res.body.shiftId, shiftId); // defaulted to the first shift
  assert.equal(res.body.shiftName, 'Standard');
  assert.equal(res.body.departmentId, null);
  assert.doesNotMatch(JSON.stringify(res.body), /password|hash/i);

  const login = await request(app).post('/api/auth/login').send({ email: body.email, password: body.password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'employee');

  const rows = await auditRows('employee.create', res.body.id);
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows[0]), /initial-password/);
});

test('create ignores role/status/userId smuggled into the body', { skip }, async () => {
  const res = await hr.post('/api/employees').send(newEmployee({ role: 'hr', status: 'inactive', userId: 1, isActive: false }));
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'active');
  assert.equal((await query('SELECT role, is_active FROM users WHERE id = $1', [res.body.userId])).rows[0].role, 'employee');
});

test('create validation: weak password, bad references and malformed fields are 400 with field names', { skip }, async () => {
  let res = await hr.post('/api/employees').send(newEmployee({ password: 'short' }));
  assert.equal(res.status, 400);
  assert.deepEqual(fieldsOf(res), ['password']);
  res = await hr.post('/api/employees').send(newEmployee({ departmentId: 999999 }));
  assert.deepEqual([res.status, ...fieldsOf(res)], [400, 'departmentId']);
  res = await hr.post('/api/employees').send(newEmployee({ shiftId: 999999 }));
  assert.deepEqual([res.status, ...fieldsOf(res)], [400, 'shiftId']);
  res = await hr.post('/api/employees').send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study', fullName: '', email: 'nope' });
  assert.equal(res.status, 400);
  assert.ok(fieldsOf(res).includes('email') && fieldsOf(res).includes('employeeCode') && fieldsOf(res).includes('startDate'));
});

test('duplicate username or employee ID is 409 (case-insensitive) and leaves no orphan login', { skip }, async () => {
  const first = await create();
  let res = await hr.post('/api/employees').send(newEmployee({ username: first.username.toUpperCase() }));
  assert.deepEqual([res.status, errorCode(res), ...fieldsOf(res)], [409, 'conflict', 'username']);
  const dup = newEmployee({ employeeCode: first.employeeCode.toLowerCase() });
  res = await hr.post('/api/employees').send(dup);
  assert.deepEqual([res.status, ...fieldsOf(res)], [409, 'employeeCode']);
  // The login row for the rejected employee must have rolled back with the failed insert.
  assert.equal((await query('SELECT count(*)::int AS n FROM users WHERE email = $1', [dup.email])).rows[0].n, 0);
});

test('list is paginated with { items, page, pageSize, total } and capped page size', { skip }, async () => {
  for (let i = 1; i <= 5; i++) await create({ fullName: `Zed ${i}` });
  const p1 = await hr.get('/api/employees?search=zed&pageSize=2&page=1');
  const p3 = await hr.get('/api/employees?search=ZED&pageSize=2&page=3');
  const p9 = await hr.get('/api/employees?search=zed&pageSize=2&page=9');
  assert.deepEqual([p1.status, p1.body.items.length, p1.body.total, p1.body.page, p1.body.pageSize], [200, 2, 5, 1, 2]);
  assert.deepEqual([p3.body.items.length, p3.body.total], [1, 5]);
  assert.deepEqual([p9.status, p9.body.items.length, p9.body.total], [200, 0, 5]);
  assert.deepEqual(p1.body.items.map((e) => e.fullName), ['Zed 1', 'Zed 2']);
  assert.equal((await hr.get('/api/employees?pageSize=101')).status, 400);
  assert.equal((await hr.get('/api/employees?page=0')).status, 400);
  assert.equal((await hr.get('/api/employees')).body.pageSize, 25);
});

test('search matches name, email and code, and treats % and _ literally', { skip }, async () => {
  const a = await create({ fullName: 'Wild%Card' });
  await create({ fullName: 'WildXCard' });
  const pct = await hr.get('/api/employees?search=wild%25card');
  assert.deepEqual(pct.body.items.map((e) => e.id), [a.id]);
  assert.ok((await hr.get(`/api/employees?search=${encodeURIComponent(a.email)}`)).body.items.some((e) => e.id === a.id));
  assert.ok((await hr.get(`/api/employees?search=${a.employeeCode.toLowerCase()}`)).body.items.some((e) => e.id === a.id));
  assert.equal((await hr.get('/api/employees?search=%25')).body.items.every((e) => /%/.test(`${e.fullName}${e.email}${e.employeeCode}`)), true);
});

test('filters by department, shift and status combine with search', { skip }, async () => {
  const dept = (await hr.post('/api/departments').send({ name: 'Filter Dept' })).body;
  const night = (await hr.post('/api/shifts').send({ name: 'Filter Night', startTime: '18:00', endTime: '23:00' })).body;
  const inDept = await create({ departmentId: dept.id, shiftId: night.id });
  const gone = await create({ departmentId: dept.id });
  await hr.post(`/api/employees/${gone.id}/deactivate`).send({});
  const byDept = await hr.get(`/api/employees?departmentId=${dept.id}`);
  assert.deepEqual(byDept.body.items.map((e) => e.id).sort(), [inDept.id, gone.id].sort());
  assert.equal(byDept.body.items.find((e) => e.id === inDept.id).departmentName, 'Filter Dept');
  assert.deepEqual((await hr.get(`/api/employees?departmentId=${dept.id}&status=active`)).body.items.map((e) => e.id), [inDept.id]);
  assert.deepEqual((await hr.get(`/api/employees?departmentId=${dept.id}&status=inactive`)).body.items.map((e) => e.id), [gone.id]);
  assert.deepEqual((await hr.get(`/api/employees?shiftId=${night.id}`)).body.items.map((e) => e.id), [inDept.id]);
  assert.equal((await hr.get('/api/employees?status=deleted')).status, 400);
});

test('get one: 200 with the record, 404 for an unknown id, 400 for a malformed id', { skip }, async () => {
  const e = await create();
  assert.deepEqual((await hr.get(`/api/employees/${e.id}`)).body, e);
  const missing = await hr.get('/api/employees/999999');
  assert.deepEqual([missing.status, errorCode(missing)], [404, 'not_found']);
  assert.equal((await hr.get('/api/employees/abc')).status, 400);
  assert.equal((await hr.get('/api/employees/1;DROP')).status, 400);
});

test('update changes only the fields sent, can clear optional fields, and is audited', { skip }, async () => {
  const dept = (await hr.post('/api/departments').send({ name: 'Update Dept' })).body;
  const e = await create({ phone: '0911000000', jobTitle: 'Clerk' });
  const res = await hr.patch(`/api/employees/${e.id}`).send({ jobTitle: 'Senior Clerk', departmentId: dept.id, phone: null, fullName: 'Renamed Person' });
  assert.equal(res.status, 200);
  assert.deepEqual(
    { jobTitle: res.body.jobTitle, departmentId: res.body.departmentId, phone: res.body.phone, fullName: res.body.fullName, username: res.body.email, email: res.body.email, employeeCode: res.body.employeeCode },
    { jobTitle: 'Senior Clerk', departmentId: dept.id, phone: null, fullName: 'Renamed Person', username: e.email, email: e.email, employeeCode: e.employeeCode });
  const rows = await auditRows('employee.update', e.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0].details.changes).sort(), ['departmentId', 'fullName', 'jobTitle', 'phone']);
  assert.deepEqual(rows[0].details.changes.jobTitle, { from: 'Clerk', to: 'Senior Clerk' });

  // A no-op update returns the record and writes no second audit row.
  assert.equal((await hr.patch(`/api/employees/${e.id}`).send({ jobTitle: 'Senior Clerk' })).status, 200);
  assert.equal((await auditRows('employee.update', e.id)).length, 1);
});

test('update rejects empty bodies, duplicates, bad references and protected fields', { skip }, async () => {
  const a = await create();
  const b = await create();
  assert.deepEqual([(await hr.patch(`/api/employees/${a.id}`).send({})).status], [400]);
  assert.equal((await hr.patch(`/api/employees/${a.id}`).send({ username: b.username })).status, 409);
  assert.equal((await hr.patch(`/api/employees/${a.id}`).send({ employeeCode: b.employeeCode.toLowerCase() })).status, 409);
  assert.deepEqual(fieldsOf(await hr.patch(`/api/employees/${a.id}`).send({ shiftId: 999999 })), ['shiftId']);
  assert.equal((await hr.patch('/api/employees/999999').send({ jobTitle: 'x' })).status, 404);
  // status and role cannot be changed through PATCH (unknown keys are dropped, leaving nothing to change)
  assert.equal((await hr.patch(`/api/employees/${a.id}`).send({ status: 'inactive', role: 'hr' })).status, 400);
  assert.equal((await hr.get(`/api/employees/${a.id}`)).body.status, 'active');
});

test('deactivate blocks login, ends live sessions, keeps the record, is audited and idempotent; activate restores', { skip }, async () => {
  const body = newEmployee();
  const e = (await hr.post('/api/employees').send(body)).body;
  const creds = { email: body.email, password: body.password };
  const live = await signIn(app, creds);
  assert.equal((await live.get('/api/auth/me')).status, 200);

  const res = await hr.post(`/api/employees/${e.id}/deactivate`).send({ reason: 'Resigned' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'inactive');
  assert.equal((await live.get('/api/auth/me')).status, 401); // existing session is gone
  assert.equal((await request(app).post('/api/auth/login').send(creds)).status, 401);
  assert.equal((await query('SELECT is_active FROM users WHERE id = $1', [e.userId])).rows[0].is_active, false);
  assert.equal((await hr.get(`/api/employees/${e.id}`)).status, 200); // history stays visible to HR

  const rows = await auditRows('employee.deactivate', e.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'Resigned');
  assert.equal((await hr.post(`/api/employees/${e.id}/deactivate`).send({})).status, 200);
  assert.equal((await auditRows('employee.deactivate', e.id)).length, 1);

  const back = await hr.post(`/api/employees/${e.id}/activate`).send({});
  assert.equal(back.body.status, 'active');
  assert.equal((await request(app).post('/api/auth/login').send(creds)).status, 200);
  assert.equal((await auditRows('employee.activate', e.id)).length, 1);
  assert.equal((await hr.post('/api/employees/999999/deactivate').send({})).status, 404);
});

test('there is no way to hard-delete an employee', { skip }, async () => {
  const e = await create();
  const res = await hr.delete(`/api/employees/${e.id}`);
  assert.equal(res.status, 404);
  assert.equal((await hr.get(`/api/employees/${e.id}`)).status, 200);
  assert.equal((await query('SELECT count(*)::int AS n FROM employees WHERE id = $1', [e.id])).rows[0].n, 1);
});
