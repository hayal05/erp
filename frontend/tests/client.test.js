import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, get, post, del, ApiError, setCsrfToken, getCsrfToken, onSessionEvent } from '../src/api/client.js';

let calls;
const reply = (status, body) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new SyntaxError('no body'); return body; } };
  };
};
beforeEach(() => { calls = []; setCsrfToken(null); onSessionEvent(null); reply(200, {}); });

test('requests go to /api, include credentials and ask for JSON', async () => {
  await get('/auth/me');
  assert.equal(calls[0].url, '/api/auth/me');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal('Content-Type' in calls[0].init.headers, false);
});

test('CSRF token is sent on writes only, and only once it is known', async () => {
  await post('/employees', { a: 1 });
  assert.equal('X-CSRF-Token' in calls[0].init.headers, false);
  setCsrfToken('tok123');
  assert.equal(getCsrfToken(), 'tok123');
  await post('/employees', { a: 1 });
  await del('/employees/5');
  await api('/x', { method: 'PATCH', body: {} });
  await api('/x', { method: 'PUT', body: {} });
  for (const c of calls.slice(1)) assert.equal(c.init.headers['X-CSRF-Token'], 'tok123', c.init.method);
  await get('/employees');
  assert.equal('X-CSRF-Token' in calls.at(-1).init.headers, false);
});

test('JSON bodies are serialised; post() without a body sends {}', async () => {
  await post('/auth/login', { email: 'a@b.co', password: 'pw' });
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, '{"email":"a@b.co","password":"pw"}');
  await post('/auth/logout');
  assert.equal(calls[1].init.body, '{}');
});

test('query params are encoded and empty values skipped', async () => {
  await get('/employees', { page: 2, q: 'a b&c', status: '', dept: undefined, x: null, zero: 0 });
  assert.equal(calls[0].url, '/api/employees?page=2&q=a+b%26c&zero=0');
  await get('/employees', {});
  assert.equal(calls[1].url, '/api/employees');
});

test('204 returns null and success returns the parsed body', async () => {
  reply(204);
  assert.equal(await post('/auth/logout'), null);
  reply(200, { ok: 1 });
  assert.deepEqual(await get('/x'), { ok: 1 });
});

test('error responses become ApiError with code, message and field errors', async () => {
  reply(400, { error: { code: 'validation', message: 'Invalid request', details: { fields: { email: 'Required' } } } });
  await assert.rejects(post('/x', {}), (e) => {
    assert.ok(e instanceof ApiError);
    assert.deepEqual([e.status, e.code, e.message], [400, 'validation', 'Invalid request']);
    assert.deepEqual(e.fields, { email: 'Required' });
    return true;
  });
  reply(502, undefined); // HTML error page from a proxy: not JSON
  await assert.rejects(get('/x'), (e) => e instanceof ApiError && e.status === 502 && e.code === 'error' && /502/.test(e.message));
});

test('network failure becomes ApiError status 0; aborts pass through untouched', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(get('/x'), (e) => e instanceof ApiError && e.status === 0 && e.code === 'network');
  globalThis.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await assert.rejects(get('/x'), (e) => e.name === 'AbortError' && !(e instanceof ApiError));
});

test('session events: 401 unauthenticated and 423 screen_locked notify the listener; wrong password does not', async () => {
  const seen = [];
  onSessionEvent((k) => seen.push(k));
  reply(401, { error: { code: 'unauthenticated', message: 'Not signed in' } });
  await assert.rejects(get('/x'));
  reply(423, { error: { code: 'screen_locked', message: 'Locked' } });
  await assert.rejects(get('/x'));
  reply(401, { error: { code: 'invalid_credentials', message: 'Invalid email or password' } });
  await assert.rejects(post('/auth/login', {}));
  reply(403, { error: { code: 'forbidden', message: 'no' } });
  await assert.rejects(get('/x'));
  assert.deepEqual(seen, ['unauthenticated', 'locked']);
});

test('file downloads preserve authenticated requests and return the blob without JSON parsing', async()=>{
 const {getFile}=await import('../src/api/client.js');
 const blob=new Blob(['csv'],{type:'text/csv'});
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return {status:200,ok:true,blob:async()=>blob,json:async()=>{throw new Error('must not parse CSV as JSON');}};};
 assert.equal(await getFile('/payroll/periods/1/export.csv'),blob);
 assert.equal(calls[0].init.credentials,'include');assert.equal(calls[0].init.headers.Accept,'text/csv');
});
test('file errors still trigger session events and never return an error document as a download',async()=>{
 const {getFile}=await import('../src/api/client.js');
 const events=[];onSessionEvent(e=>events.push(e));
 reply(423,{error:{code:'screen_locked',message:'Unlock first'}});
 await assert.rejects(getFile('/payroll/periods/1/export.csv'),{status:423,code:'screen_locked'});
 assert.deepEqual(events,['locked']);
});

function sequence(responses) {
 globalThis.fetch=async(url,init)=>{
  calls.push({url,init});const r=responses.shift();assert.ok(r,'unexpected extra request');
  if(r instanceof Error)throw r;
  return {status:r[0],ok:r[0]>=200&&r[0]<300,json:async()=>r[1]};
 };
}
const csrfFailure=[403,{error:{code:'csrf',message:'Invalid or missing CSRF token'}}];
test('login recovers a missing or stale CSRF token from the current browser session',async()=>{
 for(const stale of [null,'old-tab-token']){
  calls=[];setCsrfToken(stale);
  sequence([csrfFailure,[200,{user:{id:2},csrfToken:'current-cookie-token'}],[200,{user:{id:3},csrfToken:'new-login-token'}]]);
  const body={email:'employee@example.test',password:'password'};
  const result=await post('/auth/login',body);
  assert.equal(result.user.id,3);
  assert.deepEqual(calls.map(c=>c.url),['/api/auth/login','/api/auth/me','/api/auth/login']);
  assert.equal(calls[2].init.headers['X-CSRF-Token'],'current-cookie-token');
  assert.equal(calls[2].init.body,JSON.stringify(body));
 }
});
test('login clears a stale token if the old session expires during recovery',async()=>{
 setCsrfToken('expired-token');
 sequence([csrfFailure,[401,{error:{code:'unauthenticated'}}],[200,{user:{id:3}}]]);
 assert.equal((await post('/auth/login',{email:'employee@example.test',password:'password'})).user.id,3);
 assert.equal(calls[2].init.headers['X-CSRF-Token'],undefined);
});
test('logout can refresh its session token, avoiding a stranded browser cookie',async()=>{
 sequence([csrfFailure,[200,{csrfToken:'fresh'}],[204]]);
 assert.equal(await post('/auth/logout'),null);
 assert.equal(calls[2].init.headers['X-CSRF-Token'],'fresh');
});
test('auth CSRF recovery retries at most once and stops if refresh cannot reach the server',async()=>{
 sequence([csrfFailure,[200,{csrfToken:'fresh'}],csrfFailure]);
 await assert.rejects(post('/auth/login',{}),{status:403,code:'csrf'});assert.equal(calls.length,3);
 calls=[];sequence([csrfFailure,new TypeError('offline')]);
 await assert.rejects(post('/auth/login',{}),{status:0,code:'network'});assert.equal(calls.length,2);
});
test('CSRF origin errors and payroll/settlement writes are never automatically replayed',async()=>{
 for(const path of ['/payroll/periods','/settlements/1/payments','/auth/password']){
  calls=[];sequence([csrfFailure]);await assert.rejects(post(path,{}),{code:'csrf'});assert.equal(calls.length,1);
 }
 calls=[];sequence([[403,{error:{code:'csrf_origin',message:'Request origin is not allowed'}}]]);
 await assert.rejects(post('/auth/login',{}),{code:'csrf_origin'});assert.equal(calls.length,1);
});
