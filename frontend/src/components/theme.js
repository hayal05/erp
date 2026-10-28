// Dark is the default (matches the UI reference); the choice is remembered per browser.
// Storage access is guarded: private modes and blocked storage must not break the app.
const KEY = 'natra-theme';
export const normalizeTheme = (v) => (v === 'light' ? 'light' : 'dark');
export const otherTheme = (t) => (normalizeTheme(t) === 'light' ? 'dark' : 'light');

export function readTheme(storage = globalThis.localStorage) {
  try { return normalizeTheme(storage?.getItem(KEY)); } catch { return 'dark'; }
}
export function saveTheme(theme, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, normalizeTheme(theme)); } catch { /* not persisted: fine */ }
}
export function applyTheme(theme, root = globalThis.document?.documentElement) {
  if (root) root.dataset.theme = normalizeTheme(theme);
}
