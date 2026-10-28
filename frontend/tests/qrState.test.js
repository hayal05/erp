import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScanUrl, tokenFromHash, expiryFrom, remainingSeconds, formatCountdown } from '../src/pages/qrState.js';

const TOKEN = 'Abc_def-1234567890ABCDEFGHIJKLMNOPQRSTUV';

test('scan URL keeps the token in the fragment, never the query string', () => {
  const url = buildScanUrl('https://erp.example.com/', TOKEN);
  assert.equal(url, `https://erp.example.com/portal/scan#token=${TOKEN}`);
  assert.ok(!url.includes('?'));
  assert.equal(new URL(url).search, '');
});

test('tokenFromHash accepts only a well-formed token', () => {
  assert.equal(tokenFromHash(`#token=${TOKEN}`), TOKEN);
  for (const bad of ['', '#', '#token=', '#token=short', `#token=${TOKEN}&x=1`, `#x=${TOKEN}`, '#token=<script>alpha-bravo-charlie-delta>'])
    assert.equal(tokenFromHash(bad), null, bad);
});

test('countdown rounds up and never goes negative', () => {
  const exp = expiryFrom(1_000, 45);
  assert.equal(exp, 46_000);
  assert.equal(remainingSeconds(exp, 1_000), 45);
  assert.equal(remainingSeconds(exp, 45_100), 1);
  assert.equal(remainingSeconds(exp, 46_000), 0);
  assert.equal(remainingSeconds(exp, 99_000), 0);
  assert.equal(formatCountdown(45), '0:45');
  assert.equal(formatCountdown(7), '0:07');
  assert.equal(formatCountdown(-3), '0:00');
});

import { describeUnlockError } from '../src/pages/qrState.js';
test('unlock errors: wrong password vs throttled vs network', () => {
  assert.equal(describeUnlockError({ code: 'invalid_password' }), 'Incorrect password. Try again.');
  assert.match(describeUnlockError({ code: 'rate_limited', details: { retryAfterSeconds: 61 } }), /2 minutes/);
  assert.match(describeUnlockError({ code: 'rate_limited', details: { retryAfterSeconds: 5 } }), /1 minute\./);
  assert.equal(describeUnlockError({ status: 0, message: 'Cannot reach the server.' }), 'Cannot reach the server.');
  assert.ok(describeUnlockError(null).length > 0);
});
