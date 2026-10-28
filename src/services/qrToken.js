import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';

// QR attendance tokens (spec 7 step 1): crypto-random, single-use, short-lived, tied to the
// issuing HR session. Only an HMAC of the token is stored, so a database leak cannot be replayed.
export const TOKEN_TTL_SECONDS = 45;

// Domain-separated from session cookie hashes ('qr:' prefix) even though both use SESSION_SECRET.
export const hashQrToken = (token) =>
  crypto.createHmac('sha256', config.sessionSecret).update(`qr:${token}`).digest('hex');

export const newQrToken = () => crypto.randomBytes(32).toString('base64url'); // 256 bits

// Issues a fresh token for an HR session. Only one live QR per session: earlier unused tokens
// are expired immediately ("Generate Again" replaces the code on screen). `db` is a pool or a
// transaction client. The plain token is returned once and never stored.
export async function issueQrToken(db, { sessionId, userId }) {
  const token = newQrToken();
  await db.query(
    `UPDATE attendance_tokens SET expires_at = now()
      WHERE issued_by_session_id = $1 AND used_at IS NULL AND expires_at > now()`, [sessionId]);
  await db.query(`DELETE FROM attendance_tokens WHERE expires_at < now() - interval '1 day'`); // housekeeping
  const { rows: [row] } = await db.query(
    `INSERT INTO attendance_tokens (token_hash, issued_by_session_id, issued_by_user_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4::double precision)) RETURNING expires_at`,
    [hashQrToken(token), sessionId, userId, TOKEN_TTL_SECONDS]);
  return { token, expiresAt: row.expires_at, ttlSeconds: TOKEN_TTL_SECONDS };
}

// ---- Validation on the employee side (spec 7 step 4). Looked up by hash, never by the plain token.
export const QR_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/; // same shape the browser accepts (frontend qrState.js)
export const isQrTokenFormat = (v) => typeof v === 'string' && QR_TOKEN_RE.test(v);

// Pure: turn a lookup row into the HttpError to throw, or null when the token is usable.
// Unknown token and "issuer no longer authorised" share one answer so a guesser learns nothing.
// Check order: unknown -> already used -> expired -> issuer.
export function tokenProblem(row) {
  if (!row) return new HttpError(400, 'This QR code is not valid. Scan the code on the tablet again.', 'invalid_token');
  if (row.used) return new HttpError(409, 'This QR code was already used. Wait for a new one on the tablet.', 'token_used');
  if (row.expired) return new HttpError(410, 'This QR code has expired. Scan the new code on the tablet.', 'token_expired');
  if (!row.issuer_ok) return new HttpError(400, 'This QR code is not valid. Scan the code on the tablet again.', 'invalid_token');
  return null;
}

// Read-only check (does NOT consume): the token exists, is unused, unexpired, and the HR session that issued it still
// exists, has not expired, and belongs to an active HR user. Consumption happens inside the attendance transaction (2.14),
// which must repeat this lookup with FOR UPDATE: a check here does not reserve the token.
export async function checkQrToken(db, token, { lock = false } = {}) {
  const { rows: [row] } = await db.query(
    `SELECT t.id, t.issued_by_session_id,
            t.used_at IS NOT NULL AS used,
            t.expires_at <= now() AS expired,
            (s.id IS NOT NULL AND s.expires_at > now() AND u.is_active AND u.role = 'hr') AS issuer_ok
       FROM attendance_tokens t
       LEFT JOIN sessions s ON s.id = t.issued_by_session_id
       LEFT JOIN users u ON u.id = s.user_id
      WHERE t.token_hash = $1${lock ? ' FOR UPDATE OF t' : ''}`, [hashQrToken(token)]);
  const problem = tokenProblem(row);
  if (problem) throw problem;
  return { id: row.id, issuedBySessionId: row.issued_by_session_id };
}
