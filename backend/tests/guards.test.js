import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { default: request } = await import('supertest');
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { cookieParser, loadSession, createSession } = await import('../src/middleware/session.js');
const { requireAuth, requireRole, requireHr, requireEmployee } = await import('../src/middleware/auth.js');
const { errorHandler } = await import('../src/middleware/error.js');

// Harness: real session loading + the guards under test (feature routes arrive in later tasks).
const app = express();
app.use(cookieParser(), loadSession);
app.post('/login/:id', async (req, res, next) => {
  try { res.json(await createSession(req, res, (await query('SELECT id, role FROM users WHERE id = $1', [req.params.id])).rows[0])); }
  catch (e) { next(e); }
});
const ok = (req, res) => res.json({ ok: true });
app.get('/any', requireAuth, ok);
app.get('/hr', requireHr, ok);
app.get('/employee', requireEmployee, ok);
app.get('/both', requireRole(['hr', 'employee']), ok);
app.get('/hr-allow-locked', requireRole('hr', { allowLocked: true }), ok);
app.use(errorHandler);

let ids = {};
before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  for (const [k, role] of [['hr', 'hr'], ['emp', 'employee']]) {
    ids[k] = (await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$1,'x',$2) RETURNING id`, [`${k}@x.com`, role])).rows[0].id;
  }
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const as = async (who) => { const a = request.agent(app); await a.post(`/login/${ids[who]}`); return a; };
const code = (res) => res.body.error?.code;

test('anonymous requests get 401 on every guard', { skip }, async () => {
  for (const path of ['/any', '/hr', '/employee', '/both', '/hr-allow-locked']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 401, path);
    assert.equal(code(res), 'unauthenticated');
  }
});

test('an employee gets 403 on HR routes and 200 on employee routes', { skip }, async () => {
  const emp = await as('emp');
  for (const path of ['/hr', '/hr-allow-locked']) {
    const res = await emp.get(path);
    assert.equal(res.status, 403, path);
    assert.equal(code(res), 'forbidden');
  }
  assert.equal((await emp.get('/employee')).status, 200);
  assert.equal((await emp.get('/any')).status, 200);
});

test('HR gets 200 on HR routes and 403 on employee-only routes', { skip }, async () => {
  const hr = await as('hr');
  assert.equal((await hr.get('/hr')).status, 200);
  assert.equal((await hr.get('/employee')).status, 403);
});

test('requireRole accepts any listed role', { skip }, async () => {
  assert.equal((await (await as('hr')).get('/both')).status, 200);
  assert.equal((await (await as('emp')).get('/both')).status, 200);
});

test('a locked HR session is refused (423) unless the route opts in', { skip }, async () => {
  const hr = await as('hr');
  await query(`UPDATE sessions SET locked = true, locked_at = now() WHERE user_id = $1`, [ids.hr]);
  for (const path of ['/hr', '/both']) {
    const res = await hr.get(path);
    assert.equal(res.status, 423, path);
    assert.equal(code(res), 'screen_locked');
  }
  assert.equal((await hr.get('/hr-allow-locked')).status, 200);
  assert.equal((await hr.get('/any')).status, 200);       // requireAuth alone does not check the lock
  await query(`UPDATE sessions SET locked = false, locked_at = NULL WHERE user_id = $1`, [ids.hr]);
  assert.equal((await hr.get('/hr')).status, 200);
});

test('wrong role is reported before the lock state (no information leak to employees)', { skip }, async () => {
  const emp = await as('emp');
  await query(`UPDATE sessions SET locked = true, locked_at = now() WHERE user_id = $1`, [ids.emp]);
  assert.equal((await emp.get('/hr')).status, 403);
});
