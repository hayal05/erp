import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { default: request } = await import('supertest');
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { cookieParser, loadSession, createSession } = await import('../src/middleware/session.js');
const { csrfProtection } = await import('../src/middleware/csrf.js');
const { errorHandler } = await import('../src/middleware/error.js');

const ORIGIN = 'http://localhost:5173';
const app = express();
app.use(cookieParser(), loadSession, csrfProtection);
app.post('/login/:id', async (req, res, next) => {
  try {
    const { rows: [u] } = await query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    res.json(await createSession(req, res, u));
  } catch (e) { next(e); }
});
for (const m of ['get', 'head', 'post', 'put', 'patch', 'delete']) app[m]('/thing', (req, res) => res.json({ ok: true }));
app.use(errorHandler);

let hrId;
before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  hrId = (await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('hr@x.com','HR','x','hr') RETURNING id`)).rows[0].id;
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const login = async () => {
  const agent = request.agent(app);
  const { body } = await agent.post(`/login/${hrId}`);
  return { agent, token: body.csrfToken };
};

// ---- Origin layer (no database needed: anonymous requests carry no cookie) ----
test('foreign and "null" origins are refused on writes, even anonymous ones', async () => {
  for (const origin of ['https://evil.example', 'null', 'http://localhost:5173.evil.example']) {
    const res = await request(app).post('/thing').set('Origin', origin);
    assert.equal(res.status, 403, origin);
    assert.equal(res.body.error.code, 'csrf_origin');
  }
});

test('the frontend origin, or no origin at all, passes the origin layer', async () => {
  assert.equal((await request(app).post('/thing').set('Origin', ORIGIN)).status, 200);
  assert.equal((await request(app).post('/thing')).status, 200);
});

test('safe methods are never blocked, even from a foreign origin', async () => {
  assert.equal((await request(app).get('/thing').set('Origin', 'https://evil.example')).status, 200);
  assert.equal((await request(app).head('/thing')).status, 200);
});

// ---- Token layer ----
test('POST without a token is 403 when a session exists', { skip }, async () => {
  const { agent } = await login();
  const res = await agent.post('/thing');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'csrf');
});

test('wrong, empty and different-length tokens are rejected', { skip }, async () => {
  const { agent, token } = await login();
  for (const bad of ['wrong', '', token.slice(0, -1), token + 'x', token.toUpperCase()]) {
    const res = await agent.post('/thing').set('X-CSRF-Token', bad);
    assert.equal(res.status, 403, JSON.stringify(bad));
  }
});

test('correct token works for POST, PUT, PATCH and DELETE', { skip }, async () => {
  const { agent, token } = await login();
  for (const m of ['post', 'put', 'patch', 'delete']) {
    const res = await agent[m]('/thing').set('Origin', ORIGIN).set('X-CSRF-Token', token);
    assert.equal(res.status, 200, m);
  }
});

test('a valid token does not rescue a request from a foreign origin', { skip }, async () => {
  const { agent, token } = await login();
  const res = await agent.post('/thing').set('Origin', 'https://evil.example').set('X-CSRF-Token', token);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'csrf_origin');
});

test('GET needs no token even with a session', { skip }, async () => {
  const { agent } = await login();
  assert.equal((await agent.get('/thing')).status, 200);
});

test('a token from one session is useless in another', { skip }, async () => {
  const a = await login();
  const b = await login();
  assert.notEqual(a.token, b.token);
  assert.equal((await b.agent.post('/thing').set('X-CSRF-Token', a.token)).status, 403);
  assert.equal((await b.agent.post('/thing').set('X-CSRF-Token', b.token)).status, 200);
});
