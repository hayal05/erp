import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoStore, isPhotoId, looksLikeJpeg, MAX_BYTES, MAX_URL_TTL_SECONDS } from '../src/services/cloudinary.js';

const CFG = { cloudName: 'demo', apiKey: 'k', apiSecret: 's' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);

function fakeSdk({ uploadError = null, destroyResult = { result: 'ok' } } = {}) {
  const calls = { config: [], upload: [], destroy: [], url: [], bytes: [] };
  return {
    calls,
    config: (c) => calls.config.push(c),
    uploader: {
      upload_stream: (opts, cb) => {
        calls.upload.push(opts);
        return { end: (buf) => { calls.bytes.push(buf); setImmediate(() => (uploadError ? cb(uploadError) : cb(null, { public_id: opts.public_id }))); } };
      },
      destroy: async (id, opts) => { calls.destroy.push([id, opts]); return destroyResult; },
    },
    utils: { private_download_url: (id, fmt, opts) => { calls.url.push([id, fmt, opts]); return `https://api.cloudinary.com/dl?id=${id}&exp=${opts.expires_at}`; } },
  };
}
const store = (sdk, extra = {}) => createPhotoStore({ sdk, cfg: CFG, now: () => NOW, random: () => 'A'.repeat(24), ...extra });

test('upload is private ("authenticated"), random-named, and returns only the public id', async () => {
  const sdk = fakeSdk();
  const id = await store(sdk).upload(JPEG);
  assert.equal(id, 'natra/selfies/2026/' + 'A'.repeat(24));
  assert.ok(isPhotoId(id));
  assert.equal(sdk.calls.upload[0].type, 'authenticated');
  assert.equal(sdk.calls.upload[0].overwrite, false);
  assert.deepEqual(sdk.calls.config[0], { cloud_name: 'demo', api_key: 'k', api_secret: 's', secure: true });
  assert.equal(sdk.calls.bytes[0], JPEG);
});

test('upload rejects non-JPEG, empty and oversized files before touching Cloudinary', async () => {
  const sdk = fakeSdk();
  const s = store(sdk);
  for (const bad of [Buffer.alloc(0), Buffer.from('<svg/>'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'string', null]) {
    await assert.rejects(s.upload(bad), (e) => e.status === 400 && e.code === 'bad_photo');
  }
  await assert.rejects(s.upload(Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES)])), (e) => e.status === 413);
  assert.equal(sdk.calls.upload.length, 0);
});

test('a failed upload is a 502 and no id is returned (so no attendance is created)', async () => {
  const s = store(fakeSdk({ uploadError: new Error('network down') }));
  await assert.rejects(s.upload(JPEG), (e) => e.status === 502 && e.code === 'storage_failed' && !/network down/.test(e.message));
});

test('signed URLs are authenticated, expire, and the lifetime is capped', async () => {
  const sdk = fakeSdk();
  const s = store(sdk);
  const id = 'natra/selfies/2026/' + 'B'.repeat(24);
  const a = await s.signedUrl(id);
  assert.equal(sdk.calls.url[0][2].type, 'authenticated');
  assert.equal(sdk.calls.url[0][2].expires_at, NOW / 1000 + 300);
  assert.equal(a.expiresAt, new Date(NOW + 300_000).toISOString());
  await s.signedUrl(id, 999_999);
  assert.equal(sdk.calls.url[1][2].expires_at, NOW / 1000 + MAX_URL_TTL_SECONDS);
  await s.signedUrl(id, -5);
  assert.equal(sdk.calls.url[2][2].expires_at, NOW / 1000 + 1);
});

test('ids that are not ours are refused (no path tricks, no other folders)', async () => {
  const s = store(fakeSdk());
  for (const bad of ['', 'x', 'natra/selfies/2026/../../secret', 'other/folder/2026/' + 'A'.repeat(24), 'natra/selfies/2026/short', null, 42, 'natra/selfies/2026/' + 'A'.repeat(24) + '/x'])
    await assert.rejects(s.signedUrl(bad), /Invalid photo id/, String(bad));
  await assert.rejects(s.delete('../etc'), /Invalid photo id/);
});

test('delete is idempotent; unexpected results are errors', async () => {
  const id = 'natra/selfies/2026/' + 'C'.repeat(24);
  const ok = fakeSdk();
  await store(ok).delete(id);
  assert.deepEqual(ok.calls.destroy[0], [id, { type: 'authenticated', resource_type: 'image', invalidate: true }]);
  await store(fakeSdk({ destroyResult: { result: 'not found' } })).delete(id);
  await assert.rejects(store(fakeSdk({ destroyResult: { result: 'error' } })).delete(id), (e) => e.status === 502);
});

test('without credentials every call fails with 503 instead of crashing at boot', async () => {
  const s = createPhotoStore({ sdk: fakeSdk(), cfg: { cloudName: '', apiKey: '', apiSecret: '' } });
  assert.equal(s.configured, false);
  await assert.rejects(s.upload(JPEG), (e) => e.status === 503 && e.code === 'storage_unavailable');
});

test('looksLikeJpeg checks magic bytes only', () => {
  assert.equal(looksLikeJpeg(JPEG), true);
  assert.equal(looksLikeJpeg(Buffer.from([1, 2, 3, 4])), false);
});
