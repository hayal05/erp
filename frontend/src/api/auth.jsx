import {allowed} from './workspaces.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setCsrfToken, onSessionEvent } from './client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // status: loading (asking /me) | ready | error (server unreachable: show a retry, not a login form)
  const [approvalNotice, setApprovalNotice] = useState(null);
  const dismissApproval = useCallback(() => setApprovalNotice(null), []);
  const [state, setState] = useState({ status: 'loading', user: null, locked: false, error: null });

  const apply = useCallback((data) => {
    setApprovalNotice(null);
    setCsrfToken(data?.csrfToken);
    setState({ status: 'ready', user: data?.user ?? null, locked: !!data?.locked, error: null });
  }, []);

  const load = useCallback(async (signal) => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      apply(await get('/auth/me', undefined, { signal }));
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.status === 401) apply(null); // simply not signed in
      else setState({ status: 'error', user: null, locked: false, error: e.message });
    }
  }, [apply]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Session expired mid-use -> back to the login screen. Server says locked -> reflect it in the UI.
  useEffect(() => {
    onSessionEvent((kind, data) => {
      if (kind === 'approval_pending') { setApprovalNotice(data); return; }
      if (kind === 'permissions_changed') { get('/auth/me').then(apply).catch(e=>{if(e.status===401)apply(null);}); }
      else if (kind === 'unauthenticated') apply(null);
      else if (kind === 'password_change_required') setState(s => ({ ...s, user: s.user ? { ...s.user, mustChangePassword: true } : null }));
      else if (kind === 'locked') setState((s) => ({ ...s, locked: true }));
    });
    return () => onSessionEvent(null);
  }, [apply]);

  // Another tab may have locked or unlocked this session. When this tab regains focus, ask the server
  // (cheap, allowed while locked) and follow it. Never shows the loading splash; network errors are ignored.
  const userId = state.user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    let busy = false, disposed = false;
    const sync = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const data = await get('/auth/me');
        if (disposed) return;
        setCsrfToken(data.csrfToken);
        setState((s) => s.user ? { ...s, user: data.user, locked: !!data.locked } : s);
      } catch (e) {
        if (!disposed && e.status === 401) apply(null);
      } finally { busy = false; }
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { disposed = true; window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); };
  }, [userId, apply]);

  const login = useCallback(async (username, password) => {
    const data = await post('/auth/login', { username, password }); // throws ApiError on 400/401/429
    apply(data);
    return data.user;
  }, [apply]);

  const changePassword = useCallback(async (body) => {
    apply(await post('/auth/password', body));
  }, [apply]);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* clear local state even if the call fails */ }
    apply(null);
  }, [apply]);

  // Local mirror of the server lock flag after a successful /qr/lock or /qr/unlock (the server stays the authority).
  const setLocked = useCallback((locked) => setState((s) => ({ ...s, locked: !!locked })), []);

  const value = useMemo(
    () => ({ ...state, approvalNotice, dismissApproval, login, logout, changePassword, setLocked, reload: () => load() }),
    [state, approvalNotice, dismissApproval, login, logout, changePassword, setLocked, load],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export const usePermission=permission=>allowed(useAuth().user,permission);
