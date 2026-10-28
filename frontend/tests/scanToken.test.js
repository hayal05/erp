import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenFromLocation, loginRedirectState, postLoginState } from '../src/pages/portal/scanToken.js';
import { redirectTarget } from '../src/api/paths.js';

const T = 'Abc_def-1234567890ABCDEFGHIJKLMNOPQRSTUV';
const emp = { role: 'employee' };

test('token is read from the hash first, then from router state; junk is ignored', () => {
  assert.equal(tokenFromLocation({ hash: `#token=${T}` }), T);
  assert.equal(tokenFromLocation({ hash: '', state: { qrToken: T } }), T);
  assert.equal(tokenFromLocation({ hash: `#token=${T}`, state: { qrToken: 'x'.repeat(30) } }), T);
  for (const bad of [{}, null, { hash: '#token=short' }, { state: { qrToken: 'short' } }, { state: { qrToken: 42 } }, { hash: '#token=a b' }])
    assert.equal(tokenFromLocation(bad), null);
});

test('the guard hands the token to /login in router state, with the page to return to', () => {
  const st = loginRedirectState({ pathname: '/portal/scan', search: '', hash: `#token=${T}` });
  assert.deepEqual(st, { from: '/portal/scan', qrToken: T });
  assert.deepEqual(loginRedirectState({ pathname: '/portal', search: '?a=1', hash: '' }), { from: '/portal?a=1' });
});

test('after login the token goes only to the scan page, and only if well-formed', () => {
  assert.deepEqual(postLoginState('/portal/scan', T), { qrToken: T });
  assert.equal(postLoginState('/portal', T), undefined);
  assert.equal(postLoginState('/portal/scan', 'bad'), undefined);
  assert.equal(postLoginState('/hr/qr', T), undefined);
  assert.equal(postLoginState(undefined, T), undefined);
});

test('full round trip: scan -> login -> back on the scan page with the token, never in a URL', () => {
  const st = loginRedirectState({ pathname: '/portal/scan', search: '', hash: `#token=${T}` });
  const target = redirectTarget(st.from, emp);
  assert.equal(target, '/portal/scan');
  assert.ok(!target.includes(T));
  assert.deepEqual(postLoginState(target, st.qrToken), { qrToken: T });
});
