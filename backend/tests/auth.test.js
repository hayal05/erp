import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { default: request } = await import('supertest');
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { hashPassword } = await import('../src/services/password.js');
const { COOKIE_NAME } = await import('../src/middleware/session.js');
const { GUARD } = await import('../src/middleware/auth.js');
const { signIn, errorCode } = await import('./hrClient.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
const login = (c, agent = request(app)) => agent.post('/api/auth/login').send(c);

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const add = async (c, name, role, active = true) => query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active) VALUES ($1,$2,$3,$4,$5)`,
    [c.email, name, await hashPassword(c.password), role, active]);
  await add(HR, 'Hana HR', 'hr');
  await add(EMP, 'Eli Employee', 'employee');
  await add({ email: 'gone@natra.test', password: 'gone-password-123' }, 'Gone', 'employee', false);
});
beforeEach(() => { loginLimits.ip.clear(); loginLimits.pair.clear(); });
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

test('login succeeds, sets an HttpOnly cookie, returns the CSRF token and no secrets', { skip }, async () => {
  const res = await login(HR);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, { id: res.body.user.id, email: HR.email, fullName: 'Hana HR', role: 'hr', mustChangePassword: false });
  assert.equal(res.body.locked, false);
  assert.ok(res.body.csrfToken.length >= 40);
  assert.doesNotMatch(JSON.stringify(res.body), /password_hash|passwordHash|"(?:password|hash)"\s*:/i);
  assert.match(res.headers['set-cookie'][0], new RegExp(`^${COOKIE_NAME}=.*HttpOnly`, 'i'));
  assert.match(res.headers['cache-control'], /no-store/);
  assert.ok((await query(`SELECT last_login_at FROM users WHERE email = $1`, [HR.email])).rows[0].last_login_at);
});

test('login works for employees and ignores email case and padding', { skip }, async () => {
  const res = await login({ email: `  ${EMP.email.toUpperCase()} `, password: EMP.password });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'employee');
});

test('wrong password, unknown email and deactivated account give the same 401 and no cookie', { skip }, async () => {
  const cases = [
    { email: HR.email, password: 'wrong-password-123' },
    { email: 'nobody@natra.test', password: 'whatever-123456' },
    { email: 'gone@natra.test', password: 'gone-password-123' }, // correct password, inactive
  ];
  const bodies = [];
  for (const c of cases) {
    const res = await login(c);
    assert.equal(res.status, 401);
    assert.equal(res.headers['set-cookie'], undefined);
    bodies.push(JSON.stringify(res.body));
  }
  assert.equal(new Set(bodies).size, 1);
  assert.match(bodies[0], /invalid_credentials/);
});

test('malformed login bodies are 400, including operator-style injection', { skip }, async () => {
  for (const body of [{}, { email: HR.email }, { password: 'x' }, { email: { $ne: 1 }, password: 'x' },
    { email: HR.email, password: ['a'] }, { email: 'a'.repeat(300), password: 'x' }, { email: '  ', password: 'x' }]) {
    assert.equal((await request(app).post('/api/auth/login').send(body)).status, 400, JSON.stringify(body));
  }
});

test('wrong password x5 is throttled; the 6th attempt is blocked even with the right password', { skip }, async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login({ email: HR.email, password: 'wrong-password-123' })).status, 401);
  const blocked = await login(HR);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'rate_limited');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal(blocked.headers['set-cookie'], undefined);
  // another account from the same IP is unaffected
  assert.equal((await login(EMP)).status, 200);
});

test('a successful login resets the email+IP counter', { skip }, async () => {
  for (let i = 0; i < 4; i++) await login({ email: HR.email, password: 'wrong-password-123' });
  assert.equal((await login(HR)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await login({ email: HR.email, password: 'wrong-password-123' })).status, 401);
  assert.equal((await login(HR)).status, 200);
});

test('the per-IP cap blocks every account from that IP once reached (client IP comes from the proxy header)', { skip }, async () => {
  for (let i = 0; i < 20; i++) loginLimits.ip.fail('203.0.113.9');
  const from = (ip) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send(HR);
  assert.equal((await from('203.0.113.9')).status, 429);
  assert.equal((await from('203.0.113.10')).status, 200); // a different client is unaffected
});

test('/me returns the signed-in user, lock state and CSRF token; anonymous gets 401', { skip }, async () => {
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  const agent = request.agent(app);
  const { body } = await login(HR, agent);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, HR.email);
  assert.equal(me.body.csrfToken, body.csrfToken);
  assert.equal(me.body.locked, false);
  assert.doesNotMatch(JSON.stringify(me.body), /password_hash|passwordHash|"(?:password|hash)"\s*:/i);
});

test('logout needs the CSRF token, then ends the session', { skip }, async () => {
  const agent = request.agent(app);
  const { body } = await login(HR, agent);
  assert.equal((await agent.post('/api/auth/logout')).status, 403);          // no token
  assert.equal((await agent.get('/api/auth/me')).status, 200);               // still signed in
  const out = await agent.post('/api/auth/logout').set('X-CSRF-Token', body.csrfToken);
  assert.equal(out.status, 204);
  assert.match(out.headers['set-cookie'][0], new RegExp(`${COOKIE_NAME}=;`));
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});

test('logout while signed out is harmless', { skip }, async () => {
  assert.equal((await request(app).post('/api/auth/logout')).status, 204);
});

test('login from a foreign origin is refused (login CSRF)', { skip }, async () => {
  const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send(HR);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'csrf_origin');
  const ok = await request(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send(HR);
  assert.equal(ok.status, 200);
});

test('login and logout are audited without secrets; failed logins are not', { skip }, async () => {
  await query('TRUNCATE audit_logs');
  await login({ email: HR.email, password: 'wrong-password-123' });
  assert.equal((await query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n, 0);

  const agent = request.agent(app);
  const { body } = await login(HR, agent);
  await agent.post('/api/auth/logout').set('X-CSRF-Token', body.csrfToken);
  const { rows } = await query(
    `SELECT a.action, a.entity_type, a.entity_id, a.details::text AS d, u.email
       FROM audit_logs a JOIN users u ON u.id = a.actor_user_id ORDER BY a.id`);
  assert.deepEqual(rows.map((r) => r.action), ['auth.login', 'auth.logout']);
  assert.ok(rows.every((r) => r.email === HR.email && r.entity_type === 'user'));
  assert.ok(rows.every((r) => !/password|csrf|hr-password/i.test(r.d)));
  assert.match(rows[0].d, /"role": "hr"/);
});


// ---- Spec §26 test 1: an employee cannot reach HR pages or other people's data -------------------

// Two real employees (with records) created through the HR API, so the checks below target real ids.
let seeded;
const twoEmployees = () => (seeded ??= createTwoEmployees()); // created once; later calls reuse them
async function createTwoEmployees() {
  if (!(await query('SELECT 1 FROM shifts LIMIT 1')).rowCount) await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Standard', '09:00', '17:00')`);
  const hr = await signIn(app, HR);
  const make = async (n) => {
    const creds = { email: `staff${n}@natra.test`, password: 'staff-password-123' };
    const res = await hr.post('/api/employees').send({ employeeCode: `S${n}`, fullName: `Staff ${n}`, email: creds.email, startDate: '2026-01-05', password: creds.password });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const employee = await signIn(app, creds);
    const privatePassword = `staff-private-password-${n}`;
    const changed = await employee.post('/api/auth/password').send({ currentPassword: creds.password, newPassword: privatePassword, confirmPassword: privatePassword });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    creds.password = privatePassword;
    return { creds, record: res.body };
  };
  return { hr, a: await make(1), b: await make(2) };
}

test('every router except login is behind an access guard (a new HR route cannot ship unguarded)', { skip }, () => {
  const routers = app._router.stack.filter((l) => l.name === 'router');
  const mounts = routers.map((l) => l.regexp.source);
  assert.ok(mounts.length >= 4, `expected the auth + HR routers, found ${mounts.length}`);
  for (const layer of routers) {
    if (/auth/.test(layer.regexp.source)) continue; // login/logout/me do their own checks
    const stack = layer.handle.stack;
    const firstRoute = stack.findIndex((l) => l.route);
    const firstGuard = stack.findIndex((l) => l.handle[GUARD]);
    assert.ok(firstGuard !== -1 && firstGuard < firstRoute, `router ${layer.regexp.source} has no guard before its first route`);
  }
});

test('an employee gets 403 on every HR route, whatever the method, and anonymous gets 401', { skip }, async () => {
  const { a, b } = await twoEmployees();
  const emp = await signIn(app, a.creds);
  const other = b.record;
  const routes = [
    ['get', '/api/employees'], ['get', `/api/employees/${other.id}`], ['get', `/api/employees/${a.record.id}`], // not even their own record
    ['post', '/api/employees'], ['patch', `/api/employees/${other.id}`],
    ['post', `/api/employees/${other.id}/deactivate`], ['post', `/api/employees/${other.id}/activate`], ['delete', `/api/employees/${other.id}`],
    ['get', '/api/departments'], ['post', '/api/departments'], ['patch', '/api/departments/1'], ['delete', '/api/departments/1'],
    ['get', '/api/shifts'], ['post', '/api/shifts'], ['patch', '/api/shifts/1'], ['delete', '/api/shifts/1'],
    ['get', '/api/settings/holidays'], ['post', '/api/settings/holidays'], ['patch', '/api/settings/holidays/1'], ['delete', '/api/settings/holidays/1'],
    ['get', '/api/payroll-settings/other-taxes'], ['post', '/api/payroll-settings/other-taxes'], ['patch', '/api/payroll-settings/other-taxes/1'], ['delete', '/api/payroll-settings/other-taxes/1'],
    ['get', '/api/payroll-settings/attendance-deductions'], ['patch', '/api/payroll-settings/attendance-deductions'],
    ['get', '/api/dashboard'],
    ['get', '/api/payroll/periods/1/export.csv'],
    ['get', '/api/payroll/periods/1/entries/1'],
    ['post', '/api/payroll/periods/1/pay'],
    ['post', '/api/payroll/periods/1/approve'],
    ['patch', '/api/payroll/periods/1/entries/1'],
    ['post', '/api/payroll/periods'], ['get', '/api/payroll/periods'], ['get', '/api/payroll/periods/1'], ['get', '/api/payroll/periods/1/entries'],
    ['get', '/api/salary-profiles/1'], ['put', '/api/salary-profiles/1'],
    ['get', '/api/deductions?employeeId=1'], ['post', '/api/deductions'], ['patch', '/api/deductions/1'], ['delete', '/api/deductions/1'],
  ];
  for (const [method, url] of routes) {
    const anon = await request(app)[method](url).send({});
    assert.equal(anon.status, 401, `anonymous ${method} ${url}`);
    const res = method === 'get' ? await emp.get(url) : await emp[method](url).send({ fullName: 'Hacked', jobTitle: 'Hacked', name: 'Hacked' });
    assert.equal(res.status, 403, `employee ${method} ${url}`);
    assert.equal(errorCode(res), 'forbidden', `employee ${method} ${url}`);
    assert.equal(res.body.items, undefined);
    assert.doesNotMatch(JSON.stringify(res.body), /staff2@natra|Staff 2/);
  }
  // nothing was changed by the refused writes
  const after = await (await signIn(app, HR)).get(`/api/employees/${other.id}`);
  assert.equal(after.body.fullName, 'Staff 2');
  assert.equal(after.body.status, 'active');
});

test('an employee cannot raise their own access by claiming a role', { skip }, async () => {
  const { a } = await twoEmployees();
  const emp = await signIn(app, a.creds);
  // Built one at a time: supertest closes its ephemeral server when the first request ends, so two requests created up front break.
  for (const attempt of [
    () => emp.get('/api/employees?role=hr'),
    () => emp.get('/api/employees').set('X-Role', 'hr').set('X-User-Id', '1'),
  ]) assert.equal((await attempt()).status, 403);
  const me = await login({ ...a.creds, role: 'hr' });
  assert.equal(me.body.user.role, 'employee'); // a role in the login body is ignored
});

test('a made-up session cookie gets 401, and signing out ends access at once', { skip }, async () => {
  const { a } = await twoEmployees();
  const forged = await request(app).get('/api/employees').set('Cookie', `${COOKIE_NAME}=not-a-real-token`);
  assert.equal(forged.status, 401);
  // after logout the session is gone server-side, so access stops immediately
  const emp = await signIn(app, a.creds);
  assert.equal((await emp.get('/api/employees')).status, 403);
  assert.equal((await emp.post('/api/auth/logout').send({})).status, 204);
  assert.equal((await emp.get('/api/employees')).status, 401);
});

test('HR can still do everything the employee was refused', { skip }, async () => {
  const { hr } = await twoEmployees();
  for (const url of ['/api/employees', '/api/departments', '/api/shifts']) assert.equal((await hr.get(url)).status, 200, url);
});

// Employee payslip ownership and released-only isolation are covered in payroll.test.js (task 4.20).
