import { withAccess, loadAccessRoles } from '../services/accessGrants.js';
import changePasswordRoutes from './changePassword.js';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { createSession, destroySession } from '../middleware/session.js';
import { verifyPassword } from '../services/password.js';
import { audit } from '../services/audit.js';

const FIFTEEN_MIN = 15 * 60_000;
// Failures only. 5 per email+IP stops guessing one account; 20 per IP stops spraying many emails.
export const loginLimits = {
  pair: createLimiter({ windowMs: FIFTEEN_MIN, max: 5 }),
  ip: createLimiter({ windowMs: FIFTEEN_MIN, max: 20 }),
};

const publicUser = (u) => ({ id: Number(u.id), email: u.email, fullName: u.full_name, role: u.role, mustChangePassword: !!u.must_change_password });
const router = Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.use('/password', changePasswordRoutes);

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password
      || email.length > 254 || password.length > 256) {
    throw new HttpError(400, 'Email and password are required', 'validation');
  }
  const normalized = email.trim().toLowerCase();
  const ipKey = req.ip;
  const pairKey = `${req.ip}|${normalized}`;

  const blocked = [loginLimits.ip.check(ipKey), loginLimits.pair.check(pairKey)].find((r) => r.blocked);
  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfterSec));
    throw new HttpError(429, 'Too many failed attempts. Try again later.', 'rate_limited',
      { retryAfterSeconds: blocked.retryAfterSec });
  }

  const { rows: [user] } = await query(
    'SELECT id, email, full_name, role, password_hash, is_active, must_change_password FROM users WHERE lower(email) = $1', [normalized]);
  // Always runs a bcrypt comparison (dummy when the account is unknown) so timing is uniform.
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok || !user.is_active) {
    loginLimits.ip.fail(ipKey);
    loginLimits.pair.fail(pairKey);
    // One message for unknown email, wrong password and deactivated account.
    throw new HttpError(401, 'Invalid email or password', 'invalid_credentials');
  }

  loginLimits.pair.reset(pairKey);
  const { csrfToken } = await createSession(req, res, user);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await audit({ query }, { actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, details: { role: user.role, ip: req.ip } });
  res.json({ user: withAccess(publicUser(user), await loadAccessRoles({ query }, user.id)), csrfToken, locked: false });
}));

// Idempotent: no session is fine. With a session, the CSRF layer has already verified the token.
router.post('/logout', wrap(async (req, res) => {
  if (req.user) await audit({ query }, { actorId: req.user.id, action: 'auth.logout', entityType: 'user', entityId: req.user.id });
  await destroySession(req, res);
  res.sendStatus(204);
}));

// Lets the SPA restore its state after a reload (and learn the CSRF token + lock state).
router.get('/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Not signed in', 'unauthenticated');
  res.json({ user: req.user, csrfToken: req.session.csrfToken, locked: req.session.locked });
});

export default router;
