import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, compressToTarget, describeCameraError, PREFERRED_BYTES } from '../src/api/image.js';

// Fake encoder: size grows with pixels and quality, like a JPEG.
const fake = (k) => async (w, h, q) => ({ size: Math.round(w * h * q * k), w, h, q });

test('fitWithin scales the longer side down, keeps ratio, never scales up', () => {
  assert.deepEqual(fitWithin(1920, 1080, 960), { width: 960, height: 540 });
  assert.deepEqual(fitWithin(1080, 1920, 960), { width: 540, height: 960 });
  assert.deepEqual(fitWithin(640, 480, 960), { width: 640, height: 480 });
  assert.deepEqual(fitWithin(0, 0, 960), { width: 1, height: 1 });
});

test('compressToTarget picks the highest quality that fits the limit', async () => {
  const r = await compressToTarget(fake(0.35), 1280, 720);
  assert.ok(r.blob.size <= PREFERRED_BYTES, `size ${r.blob.size}`);
  assert.equal(r.width, 960);
  assert.ok(r.quality > 0.4 && r.quality <= 0.92);
});

test('compressToTarget uses top quality when it already fits', async () => {
  const r = await compressToTarget(fake(0.05), 640, 480);
  assert.equal(r.quality, 0.92);
});

test('compressToTarget shrinks the picture when the lowest quality is still too big', async () => {
  const r = await compressToTarget(fake(2), 1920, 1080);
  assert.ok(r.blob.size <= PREFERRED_BYTES, `size ${r.blob.size}`);
  assert.ok(r.width < 960);
});

test('compressToTarget terminates at the smallest size even if nothing fits', async () => {
  const r = await compressToTarget(fake(1e6), 1920, 1080);
  assert.equal(r.width, 320);
  assert.equal(r.quality, 0.4);
});

test('describeCameraError gives friendly text and hides raw errors', () => {
  assert.match(describeCameraError({ name: 'NotAllowedError' }), /blocked/);
  assert.match(describeCameraError({ name: 'NotFoundError' }), /No front camera/);
  assert.match(describeCameraError({ name: 'NotReadableError' }), /busy/);
  assert.match(describeCameraError(new Error('unsupported')), /secure/);
  assert.doesNotMatch(describeCameraError({ name: 'Weird', message: 'secret detail' }), /secret/);
});
