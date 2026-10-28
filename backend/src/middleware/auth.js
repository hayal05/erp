import { HttpError } from './error.js';

// Marks a middleware as an access guard so tests can prove every router (except login) has one.
export const GUARD = Symbol.for('natra.guard');
const guard = (fn) => Object.assign(fn, { [GUARD]: true });

export const requireAuth = guard((req, res, next) =>
  req.user ? next() : next(new HttpError(401, 'Not signed in', 'unauthenticated')));

// Role guard. Order of checks matters: 401 (not signed in) -> 403 (wrong role) -> 423 (locked).
// Default-deny for the tablet lock: a locked HR session is refused unless the route explicitly
// opts in with { allowLocked: true } (QR display/generate, session state, unlock, logout).
export function requireRole(roles, { allowLocked = false } = {}) {
  const allowed = new Set([].concat(roles));
  return guard((req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Not signed in', 'unauthenticated'));
    if (!allowed.has(req.user.role)) return next(new HttpError(403, 'You do not have access to this resource', 'forbidden'));
    if (req.session?.locked && !allowLocked) return next(new HttpError(423, 'This screen is locked', 'screen_locked'));
    next();
  });
}

export const requireHr = requireRole('hr');
export const requireEmployee = requireRole('employee');
