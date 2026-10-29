import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { seedAdmin } = await import('../src/db/seed.js');
const { verifyPassword } = await import('../src/services/password.js');

before(async () => { if (!skip) { await migrate({ log: () => {} }); await query(TRUNCATE_ALL); } });
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const getUser = async (email) => (await query('SELECT * FROM users WHERE lower(email) = $1', [email])).rows[0];

test('seeds an HR admin whose password verifies against the stored hash', { skip }, async () => {
  const r = await seedAdmin({ email: '  HR@Example.com ', password: 'first-password-1', name: 'Sophia' });
  assert.equal(r.created, true);
  const u = await getUser('hr@example.com');
  assert.equal(u.role, 'hr');
  assert.equal(u.full_name, 'Sophia');
  assert.notEqual(u.password_hash, 'first-password-1');
  assert.equal(await verifyPassword('first-password-1', u.password_hash), true);
  assert.equal(await verifyPassword('wrong-password-1', u.password_hash), false);
});

test('re-running leaves the existing admin and password untouched', { skip }, async () => {
  const before = await getUser('hr@example.com');
  const r = await seedAdmin({ email: 'hr@example.com', password: 'another-password-2' });
  assert.deepEqual([r.created, r.passwordReset], [false, false]);
  assert.equal((await getUser('hr@example.com')).password_hash, before.password_hash);
});

test('--reset-password changes the hash and revokes sessions', { skip }, async () => {
  const u = await getUser('hr@example.com');
  await query(`INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ('s1', $1, 'c', now() + interval '1 hour')`, [u.id]);
  const r = await seedAdmin({ email: 'hr@example.com', password: 'reset-password-3', resetPassword: true });
  assert.equal(r.passwordReset, true);
  const after = await getUser('hr@example.com');
  assert.equal(await verifyPassword('reset-password-3', after.password_hash), true);
  assert.equal(await verifyPassword('first-password-1', after.password_hash), false);
  assert.equal((await query('SELECT 1 FROM sessions WHERE user_id = $1', [u.id])).rowCount, 0);
});

test('refuses weak passwords, bad emails and non-HR collisions', { skip }, async () => {
  await assert.rejects(seedAdmin({ email: 'new@example.com', password: 'short' }), /at least 10/);
  await assert.rejects(seedAdmin({ email: 'not-an-email', password: 'long-enough-pass' }), /valid email/);
  await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('emp@example.com','E','x','employee')`);
  await assert.rejects(seedAdmin({ email: 'EMP@example.com', password: 'long-enough-pass' }), /non-HR user/);
});

test('seeding is audited and the audit trail never contains the password', { skip }, async () => {
  const { rows } = await query(`SELECT action, details::text AS d FROM audit_logs ORDER BY id`);
  assert.deepEqual(rows.map((r) => r.action), ['access.grant', 'user.create', 'user.password_reset']);
  assert.ok(rows.every((r) => !/password-\d/.test(r.d)));
});
