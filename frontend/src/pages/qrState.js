// Pure helpers for the QR page (kept free of React so they are unit-tested).

// The token travels in the URL *fragment*: browsers never send it to servers, proxies or logs,
// and it is not leaked through the Referer header. The scan page (task 2.10) reads and clears it.
export const SCAN_PATH = '/portal/scan';

export const buildScanUrl = (origin, token) => `${origin.replace(/\/+$/, '')}${SCAN_PATH}#token=${encodeURIComponent(token)}`;

// Returns the token from a location hash like "#token=abc", or null.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
export const isQrToken = (v) => typeof v === 'string' && TOKEN_RE.test(v);
export function tokenFromHash(hash = '') {
  const m = /^#token=([^&]*)$/.exec(hash);
  return m && isQrToken(m[1]) ? m[1] : null;
}

// The countdown runs off the *browser* clock: expiry = moment the response arrived + server ttl.
// That avoids trusting the tablet's wall clock against the server's. The server still enforces expiry.
export const expiryFrom = (receivedAtMs, ttlSeconds) => receivedAtMs + ttlSeconds * 1000;
export const remainingSeconds = (expiresAtMs, nowMs) => Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));

export const formatCountdown = (seconds) => `0:${String(Math.max(0, seconds)).padStart(2, '0')}`;

// Message for a failed unlock. A wrong password and a throttled attempt read differently so the person knows
// whether to retype or to wait. 'not_locked' is not an error to show: the server says we are already unlocked.
export function describeUnlockError(e) {
  if (e?.code === 'invalid_password') return 'Incorrect password. Try again.';
  if (e?.code === 'rate_limited') {
    const mins = Math.max(1, Math.ceil((e.details?.retryAfterSeconds ?? 60) / 60));
    return `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
  }
  if (e?.status === 0) return e.message;
  return e?.message || 'Could not unlock. Please try again.';
}
