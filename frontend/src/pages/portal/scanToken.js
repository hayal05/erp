import { SCAN_PATH, isQrToken, tokenFromHash } from '../qrState.js';

// Carrying the scanned QR token through the login screen (spec 7 step 2).
// The token starts in the URL fragment, which the browser never sends anywhere. Once read it lives only in
// react-router location state (history.state: this tab, this origin, never in a URL, request or storage API),
// so it survives the redirect to /login and back, and a refresh of the scan page.

// Hash wins (a fresh scan), then router state. Anything that does not look like a token is ignored.
export function tokenFromLocation(location) {
  return tokenFromHash(location?.hash ?? '') ?? (isQrToken(location?.state?.qrToken) ? location.state.qrToken : null);
}

// State for the redirect to /login from a guarded page: where to come back to, plus the token if there is one.
export function loginRedirectState(location) {
  const qrToken = tokenFromLocation(location);
  return { from: (location.pathname ?? '') + (location.search ?? ''), ...(qrToken ? { qrToken } : {}) };
}

// State to pass when navigating to the post-login target: only the scan page gets the token.
export function postLoginState(target, qrToken) {
  const path = String(target ?? '').split(/[?#]/)[0];
  return path === SCAN_PATH && isQrToken(qrToken) ? { qrToken } : undefined;
}
