import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { verifyPassword } from '../services/password.js';
import { audit } from '../services/audit.js';
import { issueQrToken } from '../services/qrToken.js';

// Tablet lock (spec 6.1/6.2). The lock lives on the server session, so it survives refresh,
// other tabs and URL tricks. Unlock re-checks the HR user's password and only ever touches
// the caller's own session. POST /tokens (2.4) issues the QR token; it is allowed while locked.
const FIFTEEN_MIN = 15 * 60_000;
// Separate from the login limiter. Failures only; per session (a stolen locked tablet gets 5 guesses)
// and per user across sessions (stops hopping between sessions).
export const unlockLimits = {
  session: createLimiter({ windowMs: FIFTEEN_MIN, max: 5 }),
  user: createLimiter({ windowMs: FIFTEEN_MIN, max: 10 }),
};

// Generating is cheap but writes a row; cap it per session (counts every request, not just failures).
export const tokenLimit = createLimiter({ windowMs: 60_000, max: 30 });

const router = Router();
// Router-level guard lets locked sessions in; middleware/lock.js narrows them to the allowlist.
router.use(noStore, requirePermission('attendance.qr.read', { allowLocked: true }));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('attendance.qr',{allowLocked:true})(req,res,next));
router.get('/status',wrap(async(req,res)=>{
  const {rows:[active]}=await query('SELECT created_at,expires_at FROM attendance_tokens WHERE expires_at>now() AND used_at IS NULL ORDER BY created_at DESC LIMIT 1');
  res.json({active:!!active,createdAt:active?.created_at??null,expiresAt:active?.expires_at??null});
}));

router.post('/tokens', wrap(async (req, res) => {
  const key = req.session.id;
  const gate = tokenLimit.check(key);
  if (gate.blocked) {
    res.set('Retry-After', String(gate.retryAfterSec));
    throw new HttpError(429, 'Too many QR codes requested. Wait a moment.', 'rate_limited', { retryAfterSeconds: gate.retryAfterSec });
  }
  tokenLimit.fail(key);
  const { token, expiresAt, ttlSeconds } = await issueQrToken({ query }, { sessionId: req.session.id, userId: req.user.id });
  res.status(201).json({ token, expiresAt, ttlSeconds });
}));

router.post('/lock', wrap(async (req, res) => {
  if (req.session.locked) throw new HttpError(423, 'This screen is locked', 'screen_locked');
  await withTransaction(async (db) => {
    await db.query('UPDATE sessions SET locked = true, locked_at = now() WHERE id = $1', [req.session.id]);
    await audit(db, { actorId: req.user.id, action: 'qr.lock', entityType: 'session', entityId: null, details: { ip: req.ip } });
  });
  res.json({ locked: true });
}));

router.post('/unlock', wrap(async (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== 'string' || !password || password.length > 256) {
    throw new HttpError(400, 'Password is required', 'validation');
  }
  if (!req.session.locked) throw new HttpError(409, 'This screen is not locked', 'not_locked');

  const sKey = req.session.id;
  const uKey = String(req.user.id);
  const blocked = [unlockLimits.session.check(sKey), unlockLimits.user.check(uKey)].find((r) => r.blocked);
  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfterSec));
    throw new HttpError(429, 'Too many failed attempts. Try again later.', 'rate_limited', { retryAfterSeconds: blocked.retryAfterSec });
  }

  const { rows: [u] } = await query('SELECT password_hash FROM users WHERE id = $1 AND is_active', [req.user.id]);
  const ok = await verifyPassword(password, u?.password_hash);
  if (!u || !ok) {
    unlockLimits.session.fail(sKey);
    unlockLimits.user.fail(uKey);
    await audit({ query }, { actorId: req.user.id, action: 'qr.unlock_failed', entityType: 'session', details: { ip: req.ip } });
    // 403, not 401: the user is still signed in, and the client treats 401 as "session ended".
    throw new HttpError(403, 'Incorrect password', 'invalid_password');
  }

  await withTransaction(async (db) => {
    // Current session only: other sessions of the same user are never touched.
    await db.query('UPDATE sessions SET locked = false, locked_at = NULL, last_seen_at = now() WHERE id = $1', [req.session.id]);
    await audit(db, { actorId: req.user.id, action: 'qr.unlock', entityType: 'session', details: { ip: req.ip } });
  });
  unlockLimits.session.reset(sKey);
  res.json({ locked: false });
}));

export default router;
