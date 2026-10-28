import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockGate, isAllowedWhileLocked, LOCKED_ALLOWLIST } from '../src/middleware/lock.js';

const run = (req) => { let err = 'none'; lockGate(req, {}, (e) => { err = e; }); return err; };
const locked = (method, path) => run({ method, path, session: { locked: true } });

test('unlocked, anonymous and employee requests pass untouched', () => {
  assert.equal(run({ method: 'GET', path: '/api/employees', session: { locked: false } }), undefined);
  assert.equal(run({ method: 'GET', path: '/api/employees', session: null }), undefined);
});

test('a locked session may use exactly the allowlist', () => {
  for (const [method, path] of LOCKED_ALLOWLIST) assert.equal(locked(method, path), undefined, `${method} ${path}`);
  assert.equal(locked('POST', '/api/qr/unlock/'), undefined); // one trailing slash tolerated
});

test('a locked session gets 423 screen_locked everywhere else', () => {
  const blocked = [
    ['GET', '/api/employees'], ['POST', '/api/employees'], ['PATCH', '/api/employees/1'], ['GET', '/api/shifts'],
    ['GET', '/api/departments'], ['POST', '/api/auth/login'], ['GET', '/api/attendance'], ['GET', '/api/payroll/periods'],
    ['GET', '/api/qr/tokens'],            // right path, wrong method
    ['GET', '/api/auth/logout'], ['DELETE', '/api/auth/me'],
    ['GET', '/api/auth/me/extra'], ['GET', '/api/auth/ME'], ['GET', '/api/auth/%6De'], ['GET', '//api/auth/me'],
    ['POST', '/api/qr/unlock//'], ['POST', '/api/qr/unlock/x'], ['GET', '/'], ['GET', ''],
  ];
  for (const [method, path] of blocked) {
    const err = locked(method, path);
    assert.equal(err?.status, 423, `${method} ${path}`);
    assert.equal(err.code, 'screen_locked');
  }
});

test('isAllowedWhileLocked is exact-match only', () => {
  assert.equal(isAllowedWhileLocked('GET', '/api/auth/me'), true);
  assert.equal(isAllowedWhileLocked('GET', '/api/auth'), false);
  assert.equal(isAllowedWhileLocked('get', '/api/auth/me'), false);
});
