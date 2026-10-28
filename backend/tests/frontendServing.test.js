import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { default: request } = await import('supertest');
const { createApp } = await import('../src/server.js');
const { inlineScriptHashes } = await import('../src/middleware/frontend.js');

const INLINE = "try{document.documentElement.dataset.theme='dark'}catch(e){}";
const HTML = `<!doctype html><html><head><script>${INLINE}</script></head><body><div id="root"></div><script type="module" src="/assets/app-abc.js"></script></body></html>`;
let dir, app;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natra-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), HTML);
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc.js'), 'console.log(1)');
  app = createApp({ serveFrontend: true, frontendDist: dir });
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('serves index.html at / and on deep client routes (SPA fallback)', async () => {
  for (const p of ['/', '/employees', '/portal/scan']) {
    const res = await request(app).get(p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers['content-type'], /html/);
    assert.match(res.text, /id="root"/);
    assert.equal(res.headers['cache-control'], 'no-cache');
  }
});

test('hashed assets are served immutable; missing assets are a real 404, not index.html', async () => {
  const ok = await request(app).get('/assets/app-abc.js');
  assert.equal(ok.status, 200);
  assert.match(ok.headers['cache-control'], /immutable/);
  const missing = await request(app).get('/assets/nope.js');
  assert.equal(missing.status, 404);
  assert.doesNotMatch(missing.text, /id="root"/);
});

test('/health and /api stay JSON and are never replaced by the app', async () => {
  const health = await request(app).get('/health');
  assert.deepEqual(health.body, { status: 'ok' });
  const api = await request(app).get('/api/does-not-exist');
  assert.equal(api.status, 404);
  assert.equal(api.body.error.code, 'not_found');
  const guarded = await request(app).get('/api/employees');
  assert.equal(guarded.status, 401);
});

test('CSP allows only the inline theme script by hash, plus selfie/QR image sources', async () => {
  const csp = (await request(app).get('/')).headers['content-security-policy'];
  const [hash] = inlineScriptHashes(HTML);
  assert.ok(hash.startsWith("'sha256-"));
  assert.ok(csp.includes(`script-src 'self' ${hash}`), csp);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), csp);
  assert.match(csp, /img-src 'self' data: blob: https:\/\/api\.cloudinary\.com https:\/\/res\.cloudinary\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal((await request(app).get('/')).headers['x-frame-options'], 'DENY');
});

test('API responses do not get the page CSP', async () => {
  const res = await request(app).get('/api/employees');
  assert.ok(!/blob:/.test(res.headers['content-security-policy'] ?? ''));
});

test('non-GET to an unknown path is still a JSON 404', async () => {
  const res = await request(app).post('/employees');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'not_found');
});

test('default (test/dev) app does not serve the frontend', async () => {
  const res = await request(createApp()).get('/employees');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'not_found');
});

test('createApp with no dist directory falls back to API-only', async () => {
  const res = await request(createApp({ serveFrontend: true, frontendDist: path.join(dir, 'missing') })).get('/employees');
  assert.equal(res.status, 404);
});
