import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
process.env.NODE_ENV = 'test';
if (url) process.env.DATABASE_URL = url;
const { pool, query, withTransaction } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');

const TABLE = 'test_migrations';
const dirs = [];
async function makeDir(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mig-'));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) await fs.writeFile(path.join(dir, name), sql);
  return dir;
}
const quiet = () => {};

after(async () => {
  if (url) await query(`DROP TABLE IF EXISTS ${TABLE}, mig_a, mig_b, mig_c, tx_probe`);
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  await pool.end();
});

test('pool is capped at 5 connections', () => assert.equal(pool.options.max, 5));

test('rejects an unsafe tracking table name', async () => {
  await assert.rejects(migrate({ table: 'x; DROP TABLE users', log: quiet }), /Invalid migrations table/);
});

test('applies migrations in order, once, and records them', { skip }, async () => {
  const dir = await makeDir({
    '002_b.sql': 'CREATE TABLE mig_b (id int);',
    '001_a.sql': 'CREATE TABLE mig_a (id int);',
    'notes.txt': 'ignored',
  });
  assert.deepEqual(await migrate({ dir, table: TABLE, log: quiet }), ['001_a.sql', '002_b.sql']);
  assert.deepEqual(await migrate({ dir, table: TABLE, log: quiet }), []); // idempotent
  const { rows } = await query(`SELECT filename FROM ${TABLE} ORDER BY filename`);
  assert.deepEqual(rows.map((r) => r.filename), ['001_a.sql', '002_b.sql']);
});

test('a failing migration rolls back fully and is not recorded', { skip }, async () => {
  const dir = await makeDir({ '003_bad.sql': 'CREATE TABLE mig_c (id int); SELECT * FROM does_not_exist;' });
  await assert.rejects(migrate({ dir, table: TABLE, log: quiet }), /003_bad\.sql failed/);
  const t = await query(`SELECT to_regclass('mig_c') AS t`);
  assert.equal(t.rows[0].t, null);
  const r = await query(`SELECT 1 FROM ${TABLE} WHERE filename = '003_bad.sql'`);
  assert.equal(r.rowCount, 0);
});

test('editing an applied migration is detected', { skip }, async () => {
  const dir = await makeDir({ '010_x.sql': 'SELECT 1;' });
  await migrate({ dir, table: TABLE, log: quiet });
  await fs.writeFile(path.join(dir, '010_x.sql'), 'SELECT 2;');
  await assert.rejects(migrate({ dir, table: TABLE, log: quiet }), /modified after being applied/);
});

test('withTransaction commits on success and rolls back on error', { skip }, async () => {
  await query('CREATE TABLE tx_probe (n int)');
  await withTransaction((c) => c.query('INSERT INTO tx_probe VALUES (1)'));
  await assert.rejects(withTransaction(async (c) => {
    await c.query('INSERT INTO tx_probe VALUES (2)');
    throw new Error('boom');
  }), /boom/);
  const { rows } = await query('SELECT n FROM tx_probe');
  assert.deepEqual(rows.map((r) => r.n), [1]);
});
