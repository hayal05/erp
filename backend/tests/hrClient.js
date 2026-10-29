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


// Explicit integration client for workflows whose administrative writes are
// submitted by this user, then reviewed by a separate Admin/department reviewer.
// Tests of the pending boundary itself use the ordinary signIn client instead.
export async function signInWithReviewer(app, credentials, reviewer) {
  const client=await signIn(app,credentials);
  const review=async response=>{
    if(response.status!==202)return response;
    assert.equal(response.body.code,'approval_pending');
    const decision=await reviewer.post(`/api/change-requests/${response.body.requestId}/approve`).send({});
    if(decision.status!==200)return Object.assign(decision,{requestId:response.body.requestId});
    assert.equal(decision.body.status,'approved');
    assert.ok(decision.body.applied,'first approval must return the applied operation result');
    return {status:decision.body.applied.status,body:decision.body.applied.body};
  };
  const write=method=>url=>{
    let pending;
    const send=body=>pending??=(Promise.resolve(client[method](url).send(body??{})).then(review));
    return {send,then:(resolve,reject)=>send().then(resolve,reject)};
  };
  return {...client,post:write('post'),put:write('put'),patch:write('patch'),delete:write('delete')};
}
