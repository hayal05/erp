import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
const { pool, query, withTransaction } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { audit, redact } = await import('../src/services/audit.js');

let actorId;
before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  actorId = (await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('hr@x.com','HR','x','hr') RETURNING id`)).rows[0].id;
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });
const last = async () => (await query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1')).rows[0];

test('redact hides secret-looking keys at any depth and leaves the rest', () => {
  const out = redact({
    name: 'Hana', Password: 'p', csrfToken: 't', nested: { sessionId: 's', authorization: 'a', keep: 1 },
    list: [{ password_hash: 'h', ok: true }], when: new Date(0),
  });
  assert.equal(out.name, 'Hana');
  assert.equal(out.Password, '[redacted]');
  assert.equal(out.csrfToken, '[redacted]');
  assert.deepEqual(out.nested, { sessionId: '[redacted]', authorization: '[redacted]', keep: 1 });
  assert.deepEqual(out.list, [{ password_hash: '[redacted]', ok: true }]);
  assert.ok(out.when instanceof Date);
});

test('writes a complete row and returns its id', { skip }, async () => {
  const id = await audit({ query }, {
    actorId, action: 'employee.update', entityType: 'employee', entityId: 42, reason: 'fixing typo',
    details: { before: { phone: '1' }, after: { phone: '2' } } });
  const row = await last();
  assert.equal(Number(row.id), id);
  assert.equal(row.actor_user_id, String(actorId));
  assert.deepEqual([row.action, row.entity_type, row.entity_id, row.reason], ['employee.update', 'employee', '42', 'fixing typo']);
  assert.deepEqual(row.details, { before: { phone: '1' }, after: { phone: '2' } });
  assert.ok(row.occurred_at instanceof Date);
});

test('secrets in details never reach the database', { skip }, async () => {
  await audit({ query }, { actorId, action: 'x.y', entityType: 'user', details: { password: 'hunter2-hunter2', csrfToken: 'abc' } });
  const row = await last();
  assert.doesNotMatch(JSON.stringify(row.details), /hunter2|abc/);
  assert.equal(row.details.password, '[redacted]');
});

test('commits and rolls back together with the surrounding transaction', { skip }, async () => {
  const count = async () => (await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'tx.test'`)).rows[0].n;
  await withTransaction((db) => audit(db, { actorId, action: 'tx.test', entityType: 't' }));
  assert.equal(await count(), 1);
  await assert.rejects(withTransaction(async (db) => {
    await audit(db, { actorId, action: 'tx.test', entityType: 't' });
    throw new Error('business rule failed');
  }), /business rule/);
  assert.equal(await count(), 1);
});

test('requires an action and entity type; actor and entity id are optional', { skip }, async () => {
  await assert.rejects(audit({ query }, { entityType: 'x' }), /action is required/);
  await assert.rejects(audit({ query }, { action: 'x' }), /entityType is required/);
  await audit({ query }, { action: 'system.job', entityType: 'system' });
  const row = await last();
  assert.deepEqual([row.actor_user_id, row.entity_id, row.reason], [null, null, null]);
});

test('oversized details are replaced by a truncation marker', { skip }, async () => {
  await audit({ query }, { actorId, action: 'big', entityType: 'x', details: { blob: 'a'.repeat(20_000) } });
  assert.deepEqual((await last()).details, { truncated: true });
});
