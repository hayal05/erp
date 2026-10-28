// Test client for HR-managed routes: signs in and sends the session's CSRF token on writes.
import assert from 'node:assert/strict';
const { default: request } = await import('supertest');

export async function signIn(app, credentials) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(credentials);
  assert.equal(res.status, 200, `login failed for ${credentials.email}`);
  const csrf = res.body.csrfToken;
  const write = (method) => (url) => agent[method](url).set('X-CSRF-Token', csrf);
  return { get: (url) => agent.get(url), post: write('post'), patch: write('patch'), put: write('put'), delete: write('delete') };
}

export const errorCode = (res) => res.body.error?.code;
export const fieldsOf = (res) => Object.keys(res.body.error?.details?.fields ?? {}).sort();
