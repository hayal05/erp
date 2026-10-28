// In-memory failure counter keyed by string (IP, email+IP, session id...).
// Fine for the single Render instance this MVP targets; counters reset on restart.
// Memory is bounded: expired keys are dropped lazily and total keys are capped.
export function createLimiter({ windowMs, max, maxKeys = 20_000, now = Date.now }) {
  const hits = new Map(); // key -> { count, resetAt }

  const live = (key) => {
    const h = hits.get(key);
    if (!h) return null;
    if (h.resetAt <= now()) { hits.delete(key); return null; }
    return h;
  };

  return {
    // Is this key currently blocked? Does not count as an attempt.
    check(key) {
      const h = live(key);
      return h && h.count >= max
        ? { blocked: true, retryAfterSec: Math.max(1, Math.ceil((h.resetAt - now()) / 1000)) }
        : { blocked: false, retryAfterSec: 0 };
    },
    // Record a failed attempt.
    fail(key) {
      let h = live(key);
      if (!h) {
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value); // evict oldest
        h = { count: 0, resetAt: now() + windowMs };
        hits.set(key, h);
      }
      h.count += 1;
    },
    reset(key) { hits.delete(key); },
    clear() { hits.clear(); },
    get size() { return hits.size; },
  };
}
