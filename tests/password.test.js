import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordProblem } from '../src/services/password.js';

test('hash verifies the right password and rejects a wrong one', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batterz', hash), false);
});

test('same password hashes differently each time (salted)', async () => {
  const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
  assert.notEqual(a, b);
});

test('missing hash (unknown account) always fails but does not throw', async () => {
  assert.equal(await verifyPassword('anything-at-all', null), false);
  assert.equal(await verifyPassword('anything-at-all', undefined), false);
});

test('password policy: min length and bcrypt 72-byte limit', async () => {
  assert.match(passwordProblem('short'), /at least 10/);
  assert.match(passwordProblem('x'.repeat(73)), /at most 72/);
  assert.match(passwordProblem('é'.repeat(37)), /at most 72/); // 74 bytes, 37 characters
  assert.equal(passwordProblem('a-long-enough-pass'), null);
  await assert.rejects(hashPassword('short'), /at least 10/);
  assert.equal(await verifyPassword('x'.repeat(100), await hashPassword('x'.repeat(72))), false);
});
