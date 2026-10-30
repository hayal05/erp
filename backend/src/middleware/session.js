import { withAccess } from '../services/accessGrants.js';
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import { config } from '../config.js';
import { query } from '../db/pool.js';

export { cookieParser };

const HOUR = 3_600_000;
// absolute = hard cap from login; idle = max gap between requests. Locked tablet sessions
// skip the idle check (employees keep using them) but still hit the absolute cap.
const POLICY = {
  hr: { absoluteMs: 12 * HOUR, idleMs: 2 * HOUR },
  employee: { absoluteMs: 12 * HOUR, idleMs: 12 * HOUR },
};
const TOUCH_AFTER_MS = 60_000; // refresh last_seen_at at most once a minute per session

export const COOKIE_NAME = config.cookie.secure ? '__Host-natra_sid' : 'natra_sid';
const baseCookie = { httpOnly: true, secure: config.cookie.secure, sameSite: config.cookie.sameSite, path: '/' };
export const cookieOptions = (expires) => ({ ...baseCookie, expires });

const newToken = () => crypto.randomBytes(32).toString('base64url');
// The database only ever sees an HMAC of the cookie token, keyed by SESSION_SECRET.
export const hashToken = (t) => crypto.createHmac('sha256', config.sessionSecret).update(t).digest('hex');

// Populates req.session / req.user, or leaves them null. Never rejects a request itself.
export async function loadSession(req, res, next) {
  req.session = null;
  req.user = null;
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== 'string' || !token || token.length > 128) return next();
  try {
    const { rows: [r] } = await query(
      `SELECT s.id, s.user_id, s.csrf_token, s.locked,
              s.expires_at <= now() AS expired,
              EXTRACT(EPOCH FROM (now() - s.last_seen_at)) * 1000 AS idle_ms,
              u.role, u.username, u.email, u.full_name, u.is_active, u.must_change_password,
              EXISTS(SELECT 1 FROM employees e WHERE e.user_id=u.id AND e.status<>'active') AS employee_inactive,
              ARRAY(SELECT g.access_role FROM access_grants g WHERE g.user_id=u.id AND g.revoked_at IS NULL ORDER BY g.access_role) AS access_roles
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1`, [hashToken(token)]);

    const idleExpired = r && !r.locked && Number(r.idle_ms) > POLICY[r.role].idleMs;
    if (!r || !r.is_active || r.employee_inactive || r.expired || idleExpired) {
      if (r) await query('DELETE FROM sessions WHERE id = $1', [r.id]);
      res.clearCookie(COOKIE_NAME, baseCookie);
      return next();
    }
    if (Number(r.idle_ms) > TOUCH_AFTER_MS) await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [r.id]);

    req.session = { id: r.id, userId: Number(r.user_id), csrfToken: r.csrf_token, locked: r.locked };
    req.user = withAccess({ id: Number(r.user_id), role: r.role, username:r.username,email: r.email, fullName: r.full_name, mustChangePassword: !!r.must_change_password }, r.access_roles);
    next();
  } catch (err) {
    next(err);
  }
}

// Called after a successful login. Always issues a fresh token (prevents session fixation)
// and revokes whatever session the browser presented before.
export async function createSession(req, res, user) {
  const previous = req.cookies?.[COOKIE_NAME];
  if (typeof previous === 'string' && previous) await query('DELETE FROM sessions WHERE id = $1', [hashToken(previous)]);
  await query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`); // housekeeping, no cron needed

  const token = newToken();
  const csrfToken = newToken();
  const { rows: [row] } = await query(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4::double precision)) RETURNING expires_at`,
    [hashToken(token), user.id, csrfToken, POLICY[user.role].absoluteMs / 1000]);
  res.cookie(COOKIE_NAME, token, cookieOptions(row.expires_at));
  return { csrfToken };
}

export async function destroySession(req, res) {
  if (req.session) await query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
  res.clearCookie(COOKIE_NAME, baseCookie);
}

// For deactivation / password change. Optionally keep the caller's own session.
export function destroyUserSessions(userId, exceptSessionId = null) {
  return query('DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2', [userId, exceptSessionId]);
}
