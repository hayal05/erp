import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { default: request } = await import('supertest');
const { app } = await import('../src/server.js');

test('GET /health returns 200 ok', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('unknown route returns JSON 404', async () => {
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'not_found');
});

test('malformed JSON returns 400, not 500', async () => {
  const res = await request(app).post('/health').set('Content-Type', 'application/json').send('{bad');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'bad_json');
});

test('CORS allows only the configured frontend origin', async () => {
  const ok = await request(app).get('/health').set('Origin', 'http://localhost:5173');
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(ok.headers['access-control-allow-credentials'], 'true');
  const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
});
