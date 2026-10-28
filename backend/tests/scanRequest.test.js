import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScanBody, MAX_BASE64_CHARS } from '../src/services/scanRequest.js';
import { tokenProblem, isQrTokenFormat } from '../src/services/qrToken.js';

const TOKEN = 'A'.repeat(43);
const jpeg = (n = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);
const b64 = (buf) => buf.toString('base64');
const fieldsOf = (fn) => { try { fn(); } catch (e) { assert.equal(e.status, 400); assert.equal(e.code, 'validation'); return Object.keys(e.details.fields).sort(); } assert.fail('did not throw'); };

test('parseScanBody accepts a token and a base64 JPEG and returns the decoded bytes', () => {
  const out = parseScanBody({ token: TOKEN, photo: b64(jpeg()) });
  assert.equal(out.token, TOKEN);
  assert.ok(Buffer.isBuffer(out.photo));
  assert.equal(out.photo[0], 0xff);
});

test('parseScanBody rejects bad tokens', () => {
  for (const token of [undefined, null, 5, '', 'short', 'x'.repeat(129), 'has space ' + 'A'.repeat(30), 'A'.repeat(30) + '/..']) {
    assert.deepEqual(fieldsOf(() => parseScanBody({ token, photo: b64(jpeg()) })), ['token'], String(token));
  }
});

test('parseScanBody rejects missing, malformed, non-JPEG and oversized photos', () => {
  const bad = [undefined, '', 12, '***not base64***', 'data:image/jpeg;base64,' + b64(jpeg()), b64(Buffer.from('GIF89a....')),
    b64(Buffer.from('<script>alert(1)</script>')), b64(jpeg(600 * 1024)), 'A'.repeat(MAX_BASE64_CHARS + 1)];
  for (const photo of bad) assert.deepEqual(fieldsOf(() => parseScanBody({ token: TOKEN, photo })), ['photo'], String(photo).slice(0, 30));
});

test('parseScanBody reports both fields at once and survives non-object bodies', () => {
  assert.deepEqual(fieldsOf(() => parseScanBody({})), ['photo', 'token']);
  for (const body of [null, undefined, 'x', 5, []]) assert.deepEqual(fieldsOf(() => parseScanBody(body)), ['photo', 'token']);
});

test('a photo exactly at the size cap is accepted', () => {
  assert.ok(parseScanBody({ token: TOKEN, photo: b64(jpeg(600 * 1024 - 4)) }).photo.length === 600 * 1024);
});

test('tokenProblem: usable row -> null; each failure has its own status and code', () => {
  const ok = { used: false, expired: false, issuer_ok: true };
  assert.equal(tokenProblem(ok), null);
  assert.deepEqual([tokenProblem(null).status, tokenProblem(null).code], [400, 'invalid_token']);
  assert.deepEqual([tokenProblem({ ...ok, used: true }).status, tokenProblem({ ...ok, used: true }).code], [409, 'token_used']);
  assert.deepEqual([tokenProblem({ ...ok, expired: true }).status, tokenProblem({ ...ok, expired: true }).code], [410, 'token_expired']);
});

test('tokenProblem: an unauthorised issuer looks the same as an unknown token', () => {
  const a = tokenProblem(null), b = tokenProblem({ used: false, expired: false, issuer_ok: false });
  assert.deepEqual([b.status, b.code, b.message], [a.status, a.code, a.message]);
});

test('tokenProblem: used wins over expired (a replay is reported as a replay)', () => {
  assert.equal(tokenProblem({ used: true, expired: true, issuer_ok: true }).code, 'token_used');
});

test('isQrTokenFormat matches what issueQrToken produces', () => {
  assert.ok(isQrTokenFormat(TOKEN));
  assert.ok(!isQrTokenFormat('a b'));
});
