import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueQrToken, hashQrToken, newQrToken, TOKEN_TTL_SECONDS } from '../src/services/qrToken.js';

const fakeDb = () => {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ expires_at: new Date('2026-10-19T08:00:45Z') }] }; } };
};

test('tokens are 256-bit random, unique, URL-safe', () => {
  const set = new Set(Array.from({ length: 200 }, newQrToken));
  assert.equal(set.size, 200);
  for (const t of set) assert.match(t, /^[A-Za-z0-9_-]{43}$/);
});

test('hash is deterministic, hex, and not the token', () => {
  const t = newQrToken();
  assert.equal(hashQrToken(t), hashQrToken(t));
  assert.match(hashQrToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashQrToken(t), hashQrToken(newQrToken()));
});

test('issue stores only the hash, expires old tokens, and uses a 45 s lifetime', async () => {
  const db = fakeDb();
  const out = await issueQrToken(db, { sessionId: 'sess', userId: 7 });
  assert.equal(out.ttlSeconds, 45);
  assert.equal(TOKEN_TTL_SECONDS, 45);
  const insert = db.calls.find((c) => /INSERT INTO attendance_tokens/.test(c.sql));
  assert.deepEqual(insert.params, [hashQrToken(out.token), 'sess', 7, 45]);
  assert.ok(!JSON.stringify(db.calls).includes(out.token), 'plain token must never reach SQL');
  assert.ok(db.calls.some((c) => /SET expires_at = now\(\)/.test(c.sql) && c.params[0] === 'sess'));
});
