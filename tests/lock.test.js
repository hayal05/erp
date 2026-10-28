// Spec 26 tests 2-6: the tablet lock is enforced on the server, per session.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { unlockLimits, tokenLimit } = await import('../src/routes/qr.js');
const { hashPassword } = await import('../src/services/password.js');
const { signIn, errorCode } = await import('./hrClient.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  for (const [c, name, role] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee']]) {
    await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4)`,
      [c.email, name, await hashPassword(c.password), role]);
  }
  await query(`INSERT INTO departments (name) VALUES ('Secret Dept')`);
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear();
  unlockLimits.session.clear(); unlockLimits.user.clear(); tokenLimit.clear();
  if (!skip) await query('DELETE FROM sessions'); // locked sessions from earlier tests must not be counted by later ones
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const lockedHr = async () => {
  const hr = await signIn(app, HR);
  assert.equal((await hr.post('/api/qr/lock').send({})).status, 200);
  return hr;
};
const noLeak = (res) => assert.doesNotMatch(JSON.stringify(res.body), /Secret Dept|hr@natra|password_hash/);

test('2: a locked session is refused (423) on admin endpoints, whatever the method', { skip }, async () => {
  const hr = await lockedHr();
  const calls = [
    ['get', '/api/employees'], ['get', '/api/employees/1'], ['post', '/api/employees'], ['patch', '/api/employees/1'],
    ['post', '/api/employees/1/deactivate'], ['delete', '/api/employees/1'],
    ['get', '/api/departments'], ['post', '/api/departments'], ['get', '/api/shifts'], ['post', '/api/shifts'],
    ['post', '/api/auth/login'], ['post', '/api/qr/lock'],
  ];
  for (const [m, url] of calls) {
    const res = m === 'get' ? await hr.get(url) : await hr[m](url).send({});
    assert.equal(res.status, 423, `${m} ${url}`);
    assert.equal(errorCode(res), 'screen_locked', `${m} ${url}`);
    noLeak(res);
  }
});

test('2: the allowlist still works while locked (me, generate QR, logout)', { skip }, async () => {
  const hr = await lockedHr();
  const me = await hr.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.locked, true);
  const tok = await hr.post('/api/qr/tokens').send({});
  assert.equal(tok.status, 201);
  assert.equal(tok.body.ttlSeconds, 45);
  assert.equal((await hr.post('/api/auth/logout').send({})).status, 204);
  assert.equal((await hr.get('/api/auth/me')).status, 401);
});

test('3: changing the URL does not bypass the lock', { skip }, async () => {
  const hr = await lockedHr();
  const urls = [
    '/api/employees/', '/api/employees?search=a', '/api/EMPLOYEES', '//api/employees', '/api/employees/%2e%2e/employees',
    '/api/qr/../employees', '/api/auth/me/../../employees', '/api/auth/me/../../departments', '/api/qr/unlock/../../employees',
    '/api/departments/', '/api/shifts?page=1',
  ];
  for (const url of urls) {
    const res = await hr.get(url);
    assert.ok([404, 423].includes(res.status), `${url} -> ${res.status}`);
    assert.equal(res.body.items, undefined, url);
    noLeak(res);
  }
});

test('4: a refresh keeps the lock (state lives on the server session)', { skip }, async () => {
  const hr = await lockedHr();
  for (let i = 0; i < 3; i++) assert.equal((await hr.get('/api/auth/me')).body.locked, true);
  assert.equal((await hr.get('/api/employees')).status, 423);
  assert.equal((await query('SELECT count(*)::int AS n FROM sessions WHERE locked')).rows[0].n, 1);
});

test('5: unlock needs the right password; wrong tries are refused and the screen stays locked', { skip }, async () => {
  const hr = await lockedHr();
  assert.equal((await hr.post('/api/qr/unlock').send({})).status, 400);
  assert.equal((await hr.post('/api/qr/unlock').send({ password: '' })).status, 400);
  assert.equal((await hr.post('/api/qr/unlock').send({ password: 12345 })).status, 400);
  const wrong = await hr.post('/api/qr/unlock').send({ password: 'wrong-password-123' });
  assert.equal(wrong.status, 403);
  assert.equal(errorCode(wrong), 'invalid_password');
  assert.equal((await hr.get('/api/auth/me')).body.locked, true);
  assert.equal((await hr.get('/api/employees')).status, 423);

  const ok = await hr.post('/api/qr/unlock').send({ password: HR.password });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { locked: false });
  assert.equal((await hr.get('/api/employees')).status, 200);
  assert.equal((await hr.get('/api/auth/me')).body.locked, false);
  assert.equal((await hr.post('/api/qr/unlock').send({ password: HR.password })).status, 409); // not locked any more
});

test('5: the password is never stored or logged; lock/unlock/failures are audited', { skip }, async () => {
  await query('TRUNCATE audit_logs');
  const hr = await lockedHr();
  await hr.post('/api/qr/unlock').send({ password: 'wrong-password-123' });
  await hr.post('/api/qr/unlock').send({ password: HR.password });
  const { rows } = await query(`SELECT action, details::text AS d FROM audit_logs WHERE action LIKE 'qr.%' ORDER BY id`);
  assert.deepEqual(rows.map((r) => r.action), ['qr.lock', 'qr.unlock_failed', 'qr.unlock']);
  assert.doesNotMatch(JSON.stringify(rows), /password-123/);
});

test('5: repeated wrong passwords are throttled, even if the next one is correct', { skip }, async () => {
  const hr = await lockedHr();
  for (let i = 0; i < 5; i++) assert.equal((await hr.post('/api/qr/unlock').send({ password: 'nope-nope-nope' })).status, 403);
  const blocked = await hr.post('/api/qr/unlock').send({ password: HR.password });
  assert.equal(blocked.status, 429);
  assert.equal(errorCode(blocked), 'rate_limited');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await hr.get('/api/auth/me')).body.locked, true);
});

test('5: employees cannot lock or unlock, and anonymous users are refused', { skip }, async () => {
  const emp = await signIn(app, EMP);
  assert.equal((await emp.post('/api/qr/lock').send({})).status, 403);
  assert.equal((await emp.post('/api/qr/unlock').send({ password: EMP.password })).status, 403);
  assert.equal((await emp.post('/api/qr/tokens').send({})).status, 403);
  const { default: request } = await import('supertest');
  assert.equal((await request(app).post('/api/qr/unlock').send({ password: HR.password })).status, 401);
});

test('6: unlocking on one device does not unlock another session of the same user', { skip }, async () => {
  const tablet = await lockedHr();
  const office = await lockedHr(); // a second device, also locked
  assert.equal((await tablet.post('/api/qr/unlock').send({ password: HR.password })).status, 200);
  assert.equal((await tablet.get('/api/employees')).status, 200);
  assert.equal((await office.get('/api/auth/me')).body.locked, true);
  assert.equal((await office.get('/api/employees')).status, 423);
});

test('6: locking one device does not lock another', { skip }, async () => {
  const a = await signIn(app, HR);
  const b = await signIn(app, HR);
  assert.equal((await a.post('/api/qr/lock').send({})).status, 200);
  assert.equal((await a.get('/api/employees')).status, 423);
  assert.equal((await b.get('/api/employees')).status, 200);
});

test('QR tokens: new code replaces the previous one; only the hash is stored', { skip }, async () => {
  await query('TRUNCATE attendance_tokens CASCADE');
  const hr = await signIn(app, HR);
  const first = (await hr.post('/api/qr/tokens').send({})).body;
  const second = (await hr.post('/api/qr/tokens').send({})).body;
  assert.notEqual(first.token, second.token);
  const { rows } = await query('SELECT token_hash, expires_at > now() AS live FROM attendance_tokens ORDER BY id');
  assert.deepEqual(rows.map((r) => r.live), [false, true]);
  assert.ok(rows.every((r) => !r.token_hash.includes(first.token) && !r.token_hash.includes(second.token)));
});
