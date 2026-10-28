import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
const { default: request } = await import('supertest');
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { cookieParser, loadSession, createSession, destroySession, destroyUserSessions, COOKIE_NAME, hashToken } =
  await import('../src/middleware/session.js');

// Minimal harness app: auth routes arrive in task 1.8.
const app = express();
app.use(cookieParser(), loadSession);
app.post('/login/:id', async (req, res, next) => {
  try {
    const { rows: [u] } = await query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    res.json(await createSession(req, res, u));
  } catch (e) { next(e); }
});
app.get('/whoami', (req, res) => res.json({ user: req.user, session: req.session }));
app.post('/logout', async (req, res, next) => { try { await destroySession(req, res); res.sendStatus(204); } catch (e) { next(e); } });

let hrId, empId;
before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  hrId = (await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('hr@x.com','HR','x','hr') RETURNING id`)).rows[0].id;
  empId = (await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('e@x.com','Emp','x','employee') RETURNING id`)).rows[0].id;
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const login = async (id = hrId) => {
  const agent = request.agent(app);
  const res = await agent.post(`/login/${id}`);
  return { agent, res, cookie: res.headers['set-cookie'][0] };
};
const row = async (where = '', params = []) => (await query(`SELECT * FROM sessions ${where} ORDER BY created_at DESC LIMIT 1`, params)).rows[0];

test('login sets an HttpOnly, SameSite cookie and creates a hashed session row', { skip }, async () => {
  const { res, cookie } = await login();
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//);
  const token = cookie.split(';')[0].split('=')[1];
  const r = await row();
  assert.equal(r.id, hashToken(token));
  assert.notEqual(r.id, token);                  // raw token is never stored
  assert.equal(r.csrf_token, res.body.csrfToken);
  assert.equal(r.locked, false);
  const hours = (r.expires_at - Date.now()) / 3_600_000;
  assert.ok(hours > 11.9 && hours <= 12.01, `expires in ${hours}h`);
});

test('a valid cookie identifies the user; no cookie means anonymous', { skip }, async () => {
  const { agent } = await login();
  const me = await agent.get('/whoami');
  assert.equal(me.body.user.email, 'hr@x.com');
  assert.equal(me.body.user.role, 'hr');
  assert.equal(me.body.session.locked, false);
  assert.deepEqual((await request(app).get('/whoami')).body, { user: null, session: null });
});

test('unknown or tampered tokens are anonymous and the cookie is cleared', { skip }, async () => {
  const res = await request(app).get('/whoami').set('Cookie', `${COOKIE_NAME}=not-a-real-token`);
  assert.equal(res.body.user, null);
  assert.match(res.headers['set-cookie'][0], new RegExp(`${COOKIE_NAME}=;`));
});

test('expired sessions are rejected and deleted', { skip }, async () => {
  const { agent } = await login();
  await query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = (SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1)`);
  assert.equal((await agent.get('/whoami')).body.user, null);
});

test('HR sessions time out when idle, but locked tablet sessions do not', { skip }, async () => {
  const idle = await login();
  await query(`UPDATE sessions SET last_seen_at = now() - interval '3 hours' WHERE id = $1`, [(await row()).id]);
  assert.equal((await idle.agent.get('/whoami')).body.user, null);

  const tablet = await login();
  const id = (await row()).id;
  await query(`UPDATE sessions SET locked = true, locked_at = now(), last_seen_at = now() - interval '5 hours' WHERE id = $1`, [id]);
  const me = await tablet.agent.get('/whoami');
  assert.equal(me.body.user.email, 'hr@x.com');
  assert.equal(me.body.session.locked, true);
});

test('last_seen_at is refreshed at most once a minute', { skip }, async () => {
  const { agent } = await login();
  const id = (await row()).id;
  const seen = async () => (await query('SELECT last_seen_at FROM sessions WHERE id = $1', [id])).rows[0].last_seen_at.getTime();
  const t0 = await seen();
  await agent.get('/whoami');
  assert.equal(await seen(), t0);                                   // fresh: no write
  await query(`UPDATE sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = $1`, [id]);
  const stale = await seen();
  await agent.get('/whoami');
  assert.ok(await seen() > stale);                                  // stale: refreshed
});

test('deactivated users lose their session immediately', { skip }, async () => {
  const { agent } = await login(empId);
  assert.equal((await agent.get('/whoami')).body.user.role, 'employee');
  await query('UPDATE users SET is_active = false WHERE id = $1', [empId]);
  assert.equal((await agent.get('/whoami')).body.user, null);
  await query('UPDATE users SET is_active = true WHERE id = $1', [empId]);
});

test('logout deletes the row and clears the cookie', { skip }, async () => {
  const { agent } = await login();
  const id = (await row()).id;
  const out = await agent.post('/logout');
  assert.equal(out.status, 204);
  assert.match(out.headers['set-cookie'][0], new RegExp(`${COOKIE_NAME}=;`));
  assert.equal((await query('SELECT 1 FROM sessions WHERE id = $1', [id])).rowCount, 0);
  assert.equal((await agent.get('/whoami')).body.user, null);
});

test('logging in again revokes the previous session (no fixation)', { skip }, async () => {
  const { agent, cookie } = await login();
  const first = (await row()).id;
  await agent.post(`/login/${hrId}`);
  assert.equal((await query('SELECT 1 FROM sessions WHERE id = $1', [first])).rowCount, 0);
  const stale = await request(app).get('/whoami').set('Cookie', cookie.split(';')[0]);
  assert.equal(stale.body.user, null);
});

test('destroyUserSessions can spare the caller’s own session', { skip }, async () => {
  const a = await login(); const keep = (await row()).id;
  const b = await login(); const other = (await row()).id;
  await destroyUserSessions(hrId, keep);
  assert.equal((await query('SELECT 1 FROM sessions WHERE id = $1', [keep])).rowCount, 1);
  assert.equal((await query('SELECT 1 FROM sessions WHERE id = $1', [other])).rowCount, 0);
  assert.equal((await a.agent.get('/whoami')).body.user.email, 'hr@x.com');
  assert.equal((await b.agent.get('/whoami')).body.user, null);
});

test('production cookies are Secure with the __Host- prefix', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import('./src/middleware/session.js'); console.log(JSON.stringify({ n: m.COOKIE_NAME, o: m.cookieOptions(new Date(0)) }))`], {
    env: { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@localhost/db',
      FRONTEND_URL: 'https://app.example.com', SESSION_SECRET: 'x'.repeat(40) },
    cwd: new URL('..', import.meta.url).pathname }).toString();
  const { n, o } = JSON.parse(out);
  assert.equal(n, '__Host-natra_sid');
  assert.deepEqual([o.secure, o.httpOnly, o.path, o.sameSite], [true, true, '/', 'lax']);
});
