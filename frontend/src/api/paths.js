// Where each role lives, and where to send someone after login. Pure functions (no React) so they are unit-tested.
export const homePath = (user) => (user?.role === 'hr' ? '/hr' : '/portal');
const AREA = { hr: '/hr', employee: '/portal' };

// `from` is the page the person was heading to before being sent to /login (set by RequireRole).
// Only same-app paths inside the user's own area are honoured, so it can never become an open
// redirect or push someone into an area their role cannot use; anything else lands on their home.
export function redirectTarget(from, user) {
  const home = homePath(user);
  if (typeof from !== 'string' || from.length > 2000 || !from.startsWith('/') || from.startsWith('//')
      || from.includes('\\') || /[\u0000-\u001f]/.test(from)) return home;
  const area = AREA[user?.role];
  const path = from.split(/[?#]/)[0];
  return area && (path === area || path.startsWith(`${area}/`)) ? from : home;
}
