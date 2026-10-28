import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePath, redirectTarget } from '../src/api/paths.js';

const hr = { role: 'hr' };
const emp = { role: 'employee' };

test('each role lands in its own area by default', () => {
  assert.equal(homePath(hr), '/hr');
  assert.equal(homePath(emp), '/portal');
  assert.equal(redirectTarget(undefined, hr), '/hr');
  assert.equal(redirectTarget(null, emp), '/portal');
});

test('a saved page inside the user\'s own area is honoured, including query strings', () => {
  assert.equal(redirectTarget('/hr/employees', hr), '/hr/employees');
  assert.equal(redirectTarget('/portal/scan?t=abc123', emp), '/portal/scan?t=abc123');
  assert.equal(redirectTarget('/portal', emp), '/portal');
});

test('a saved page in the other role\'s area falls back to home', () => {
  assert.equal(redirectTarget('/hr/payroll', emp), '/portal');
  assert.equal(redirectTarget('/portal/scan?t=abc', hr), '/hr');
});

test('look-alike prefixes, login loops and non-area paths fall back to home', () => {
  for (const bad of ['/hrx', '/hr-secrets', '/portalx/y', '/login', '/', '/unknown']) {
    assert.equal(redirectTarget(bad, hr), '/hr', bad);
    assert.equal(redirectTarget(bad, emp), '/portal', bad);
  }
});

test('open-redirect attempts and junk values fall back to home', () => {
  for (const bad of ['//evil.com', 'https://evil.com/hr', '/\\evil.com', '/hr\\..', 'hr/employees', '/hr\n/x',
    42, {}, [], '/hr/' + 'a'.repeat(2100)]) {
    assert.equal(redirectTarget(bad, hr), '/hr', String(bad).slice(0, 30));
  }
});

test('an unknown role is never sent into either area', () => {
  assert.equal(redirectTarget('/hr/employees', { role: 'kiosk' }), '/portal');
  assert.equal(redirectTarget('/portal', undefined), '/portal');
});
