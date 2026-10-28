import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Two layers for every state-changing request (POST/PUT/PATCH/DELETE):
// 1. Origin check: browsers always attach Origin to cross-origin writes, so a foreign (or
//    "null") Origin is refused. This also covers anonymous endpoints such as login.
//    Requests with no Origin (curl, server-to-server, tests) are allowed here because they
//    carry no ambient browser cookies; layer 2 still applies if they present a session.
// 2. Synchronizer token: whenever the request carries a valid session, the X-CSRF-Token
//    header must equal the token stored server-side for that session.
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (origin !== undefined && origin !== config.frontendUrl) {
    return next(new HttpError(403, 'Request origin is not allowed', 'csrf_origin'));
  }
  if (req.session && !safeEqual(req.get('x-csrf-token'), req.session.csrfToken)) {
    return next(new HttpError(403, 'Invalid or missing CSRF token', 'csrf'));
  }
  next();
}
