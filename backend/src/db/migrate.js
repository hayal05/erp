import { reportFailure } from '../services/logging.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from './pool.js';
import { config } from '../config.js';

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations');
const LOCK_ID = 727_001; // arbitrary constant: serialises concurrent runs (e.g. two Render instances)

// Applies database/migrations/NNN_name.sql files in filename order, each in its own
// transaction, exactly once. Returns the list of files applied by this run.
export async function migrate({ dir = DEFAULT_DIR, table = 'schema_migrations', log = console.log } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Invalid migrations table name');
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS ${table} (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);

    const files = (await fs.readdir(dir)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
    const applied = new Map((await client.query(`SELECT filename, checksum FROM ${table}`)).rows
      .map((r) => [r.filename, r.checksum]));

    const ran = [];
    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (applied.has(file)) {
        if (applied.get(file) !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO ${table} (filename, checksum) VALUES ($1, $2)`, [file, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      log(`applied ${file}`);
      ran.push(file);
    }
    if (!ran.length) log('database is up to date');
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

// CLI: `npm run migrate`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => pool.end())
    .catch(async (err) => {
      reportFailure('migration', err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
