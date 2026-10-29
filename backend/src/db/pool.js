import pg from 'pg';
import {approvalTransaction} from '../services/approvalExecution.js';
import { reportFailure } from '../services/logging.js';
import { config } from '../config.js';

// Small pool: Neon free + Render free (~512 MB) only need a handful of connections.
// TLS is driven by the connection string (?sslmode=require for Neon).
export const pool = new pg.Pool({
  connectionString: config.databaseUrl || undefined,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An idle client erroring (e.g. Neon suspending) must not crash the process.
pool.on('error', (err) => {
  if (!config.isTest) reportFailure('database', err);
});

function assertConfigured() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');
}

export function query(text, params) {
  assertConfigured();
  return (approvalTransaction.getStore() || pool).query(text, params);
}

// Runs fn(client) inside BEGIN/COMMIT; rolls back and rethrows on any error.
export async function withTransaction(fn) {
  assertConfigured();
  if (approvalTransaction.getStore()) return fn(approvalTransaction.getStore());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}
