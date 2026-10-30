import {clearIncrementalData, syncIncrementalIdentity, readBaseline, decodeIncrementalData} from './incrementalData.js';
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
export const setCsrfToken = (t) => { if (csrfToken !== (t || null)) clearIncrementalData(); csrfToken = t || null; };
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

export async function api(path, { method = 'GET', body, query, signal, responseType = 'json', csrfRetried = false, deltaRetried = false } = {}) {
  const headers = { Accept: responseType === 'blob' ? 'text/csv' : 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const url = buildUrl(path, query);
  const incremental = method === 'GET' && responseType === 'json' && !path.startsWith('/auth') && !path.startsWith('/qr') && !path.includes('/photos/');
  const baseline = readBaseline(url);
  if (incremental) headers['X-Data-Delta'] = !deltaRetried && baseline.entry ? baseline.entry.version : 'initial';
  if (!SAFE.has(method) && path.startsWith('/auth/')) clearIncrementalData();
  let res;
  try {
    res = await fetch(url, {
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
  if (res.status === 202 && data?.code === 'approval_pending') {
    listener('approval_pending', data);
    throw new ApiError(202, data.code, data.message, {requestId:data.requestId});
  }
  if (res.ok) {
    if (path.startsWith('/auth/')) syncIncrementalIdentity(data);
    if (incremental) {
      try { return decodeIncrementalData(url, data, baseline); }
      catch {
        if (!deltaRetried && baseline.epoch === readBaseline(url).epoch) return api(path, { method, query, signal, responseType, deltaRetried: true });
        throw new ApiError(0, 'refresh_failed', 'Could not update this page. Open the section again.');
      }
    }
    return data;
  }

  if ([401, 403, 423].includes(res.status)) clearIncrementalData();
  const err = data?.error ?? {};
  const apiErr = new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`, err.details);
  // A different tab (or a failed logout) can leave a cookie newer than our in-memory token.
  // These auth requests were rejected before their handlers ran; refresh the token and retry once.
  // Other writes are never replayed automatically, especially payroll and settlement operations.
  if (!csrfRetried && res.status === 403 && apiErr.code === 'csrf' && method === 'POST'
      && (path === '/auth/login' || path === '/auth/logout')) {
    try {
      const session = await api('/auth/me', { signal });
      setCsrfToken(session.csrfToken);
    } catch (e) {
      if (e.status === 401) setCsrfToken(null);
      else throw e;
    }
    return api(path, { method, body, query, signal, responseType, csrfRetried: true });
  }
  if (apiErr.code === 'password_change_required') listener('password_change_required');
  else if (apiErr.code === 'unauthenticated') listener('unauthenticated');
  else if (apiErr.code === 'forbidden') listener('permissions_changed');
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
