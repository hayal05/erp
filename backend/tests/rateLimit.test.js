import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/middleware/rateLimit.js';

const clock = (t = 0) => ({ now: () => t, advance: (ms) => { t += ms; } });

test('blocks a key after max failures and reports retry time', () => {
  const c = clock();
  const l = createLimiter({ windowMs: 60_000, max: 3, now: c.now });
  for (let i = 0; i < 2; i++) l.fail('k');
  assert.equal(l.check('k').blocked, false);
  l.fail('k');
  const r = l.check('k');
  assert.deepEqual([r.blocked, r.retryAfterSec], [true, 60]);
  c.advance(45_000);
  assert.equal(l.check('k').retryAfterSec, 15);
});

test('window expiry unblocks and starts a fresh count', () => {
  const c = clock();
  const l = createLimiter({ windowMs: 1_000, max: 1, now: c.now });
  l.fail('k');
  assert.equal(l.check('k').blocked, true);
  c.advance(1_000);
  assert.equal(l.check('k').blocked, false);
  l.fail('k');
  assert.equal(l.check('k').blocked, true);
});

test('keys are independent; reset and clear work; check does not count', () => {
  const l = createLimiter({ windowMs: 1_000, max: 1 });
  for (let i = 0; i < 10; i++) l.check('a');
  assert.equal(l.check('a').blocked, false);
  l.fail('a');
  assert.equal(l.check('b').blocked, false);
  l.reset('a');
  assert.equal(l.check('a').blocked, false);
  l.fail('a'); l.fail('b'); l.clear();
  assert.equal(l.size, 0);
});

test('memory is bounded by evicting the oldest keys', () => {
  const l = createLimiter({ windowMs: 60_000, max: 1, maxKeys: 3 });
  for (const k of ['1', '2', '3', '4']) l.fail(k);
  assert.equal(l.size, 3);
  assert.equal(l.check('1').blocked, false); // evicted
  assert.equal(l.check('4').blocked, true);
});
