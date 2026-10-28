import { reportFailure } from '../services/logging.js';
import { pathToFileURL } from 'node:url';
import { pool, withTransaction } from './pool.js';
import { config } from '../config.js';
import { hashPassword } from '../services/password.js';
import { audit } from '../services/audit.js';

const PLACEHOLDER_PASSWORD = 'change-me-now';

// Creates the first HR administrator. Safe to re-run: an existing HR user is left untouched
// unless resetPassword is set (the recovery path, since the MVP has no email reset flow).
export async function seedAdmin({ email, password, name = 'HR Administrator', resetPassword = false }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('SEED_ADMIN_EMAIL is not a valid email');
  if (config.isProd && password === PLACEHOLDER_PASSWORD) throw new Error('Refusing to seed the placeholder password in production');
  const hash = await hashPassword(password); // validates strength; computed before opening a transaction

  return withTransaction(async (db) => {
    const log = (id, action) => audit(db, { action, entityType: 'user', entityId: id, details: { via: 'seed script' } });

    const { rows: [existing] } = await db.query('SELECT id, role FROM users WHERE lower(email) = $1 FOR UPDATE', [email]);
    if (existing) {
      if (existing.role !== 'hr') throw new Error('A non-HR user already uses that email');
      if (!resetPassword) return { id: existing.id, created: false, passwordReset: false };
      await db.query('UPDATE users SET password_hash = $1, is_active = true WHERE id = $2', [hash, existing.id]);
      await db.query('DELETE FROM sessions WHERE user_id = $1', [existing.id]); // force re-login everywhere
      await log(existing.id, 'user.password_reset');
      return { id: existing.id, created: false, passwordReset: true };
    }
    const { rows: [user] } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, 'hr') RETURNING id`,
      [email, name, hash]);
    await log(user.id, 'user.create');
    return { id: user.id, created: true, passwordReset: false };
  });
}

// CLI: `npm run seed` or `npm run seed -- --reset-password`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedAdmin({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    name: process.env.SEED_ADMIN_NAME || undefined,
    resetPassword: process.argv.includes('--reset-password'),
  })
    .then((r) => {
      console.log(r.created ? 'HR admin created.'
        : r.passwordReset ? 'HR admin password reset; all sessions revoked.'
        : 'HR admin already exists; nothing changed (use --reset-password to change the password).');
      return pool.end();
    })
    .catch(async (err) => {
      reportFailure('seed', err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
