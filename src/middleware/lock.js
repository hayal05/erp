import { HttpError } from './error.js';

// Global tablet-lock gate (spec 6.1). A locked session may only reach the routes below;
// everything else is refused with 423, whatever the URL, tab or back button. This is the
// outer layer: requireRole() in auth.js is the inner one (default-deny unless allowLocked).
// Keep this list in step with the routes that pass { allowLocked: true }.
export const LOCKED_ALLOWLIST = Object.freeze([
  ['GET', '/api/auth/me'],        // minimal session state (restores locked mode after refresh)
  ['POST', '/api/auth/logout'],
  ['POST', '/api/qr/tokens'],     // generate a QR token (display + Generate Again)
  ['POST', '/api/qr/unlock'],     // unlock needs the password again (task 2.3)
]);

// Exact, case-sensitive match on the raw path; an unknown or oddly encoded path simply
// fails the match and is refused (fail closed). One trailing slash is tolerated.
export const isAllowedWhileLocked = (method, path) => {
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return LOCKED_ALLOWLIST.some(([m, allowed]) => m === method && allowed === p);
};

export function lockGate(req, res, next) {
  if (!req.session?.locked) return next();
  if (isAllowedWhileLocked(req.method, req.path)) return next();
  next(new HttpError(423, 'This screen is locked', 'screen_locked'));
}
