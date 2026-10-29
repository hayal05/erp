// Thin fetch wrapper for the Natra API. All API routes live under /api.
// VITE_API_URL is the API origin (http://localhost:4000 in dev). Leave it empty to call the same
// origin, which is what you want if /api is proxied through the static site.

const BASE = (import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  // Per-field messages from the server's validation layer: { email: 'Required' }
  get fields() { return this.details?.fields ?? {}; }
}

// The CSRF token lives in memory only (never localStorage): it is re-learned from /auth/me on reload.
let csrfToken = null;
export const setCsrfToken = (t) => { csrfToken = t || null; };
export const getCsrfToken = () => csrfToken;

// The auth context subscribes here to react to a session that ended or a tablet that got locked.
let listener = () => {};
export const onSessionEvent = (fn) => { listener = fn || (() => {}); };

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function buildUrl(path, query) {
  const qs = new URLSearchParams();
  for (const [k, val] of Object.entries(query ?? {})) {
    if (val !== undefined && val !== null && val !== '') qs.append(k, String(val));
  }
  const s = qs.toString();
  return `${BASE}/api${path}${s ? `?${s}` : ''}`;
}

export async function api(path, { method = 'GET', body, query, signal, responseType = 'json' } = {}) {
  const headers = { Accept: responseType === 'blob' ? 'text/csv' : 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method, headers, credentials: 'include', signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;
  if (res.ok && responseType === 'blob') return res.blob();
  const data = await res.json().catch(() => null); // proxies can return HTML error pages
  if (res.ok) return data;

  const err = data?.error ?? {};
  const apiErr = new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`, err.details);
  if (apiErr.code === 'password_change_required') listener('password_change_required');
  else if (apiErr.code === 'unauthenticated') listener('unauthenticated');
  else if (apiErr.code === 'screen_locked') listener('locked');
  throw apiErr;
}

export const get = (path, query, opts) => api(path, { ...opts, query });
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body: body ?? {} });
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body: body ?? {} });
export const patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body: body ?? {} });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });

// Uses the same authenticated fetch/error/session handling as JSON requests.
export const getFile = (path, opts) => api(path, { ...opts, responseType: 'blob' });
