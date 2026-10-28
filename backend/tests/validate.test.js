import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import './helpers.js';
const { default: request } = await import('supertest');
const { v, parse, validate } = await import('../src/middleware/validate.js');
const { errorHandler } = await import('../src/middleware/error.js');

const errs = (schema, data, opts) => parse(schema, data, opts).errors;

test('valid input is trimmed, typed, and unknown keys are dropped', () => {
  const { value, errors } = parse(
    { name: v.string({ required: true }), email: v.email({ required: true }), age: v.int() },
    { name: '  Abebe  ', email: ' A@X.com ', age: 30, isAdmin: true, role: 'hr' });
  assert.equal(errors, null);
  assert.deepEqual(value, { name: 'Abebe', email: 'a@x.com', age: 30 });
});

test('required fields: missing, empty and whitespace-only are all rejected', () => {
  const schema = { name: v.string({ required: true }) };
  for (const bad of [{}, { name: '' }, { name: '   ' }, { name: undefined }, { name: null }]) {
    assert.deepEqual(errs(schema, bad), { name: 'Required' }, JSON.stringify(bad));
  }
});

test('optional fields can be omitted, nullable ones accept null, defaults apply', () => {
  const schema = { a: v.string(), b: v.int({ nullable: true }), c: v.boolean({ default: false }) };
  assert.deepEqual(parse(schema, {}).value, { c: false });
  assert.deepEqual(parse(schema, { b: null }).value, { b: null, c: false });
  assert.deepEqual(errs({ b: v.int() }, { b: null }), null); // null on a non-nullable optional = omitted
});

test('strings: type, length, default max, pattern', () => {
  assert.match(errs({ s: v.string() }, { s: 123 }).s, /text/);
  assert.match(errs({ s: v.string({ min: 3 }) }, { s: 'ab' }).s, /at least 3/);
  assert.match(errs({ s: v.string({ max: 3 }) }, { s: 'abcd' }).s, /at most 3/);
  assert.match(errs({ s: v.string() }, { s: 'x'.repeat(256) }).s, /at most 255/);
  assert.equal(errs({ s: v.string({ max: 1000 }) }, { s: 'x'.repeat(256) }), null);
  assert.equal(errs({ s: v.string({ pattern: /^E\d+$/, patternMessage: 'Bad code' }) }, { s: 'X1' }).s, 'Bad code');
});

test('email: format and lowercasing', () => {
  for (const bad of ['plain', 'a@b', 'a b@c.com', '@c.com', 'a@@c.com']) {
    assert.match(errs({ e: v.email() }, { e: bad }).e, /valid email/, bad);
  }
  assert.equal(parse({ e: v.email() }, { e: 'Hr@Natra.COM' }).value.e, 'hr@natra.com');
});

test('int and number: strict for bodies, coerced for query strings, with ranges', () => {
  assert.match(errs({ n: v.int() }, { n: '5' }).n, /whole number/);
  assert.match(errs({ n: v.int() }, { n: 1.5 }).n, /whole number/);
  assert.match(errs({ n: v.int() }, { n: 2 ** 60 }).n, /whole number/);
  assert.equal(parse({ n: v.int() }, { n: '5' }, { coerce: true }).value.n, 5);
  assert.match(errs({ n: v.int() }, { n: '5x' }, { coerce: true }).n, /whole number/);
  assert.match(errs({ n: v.int({ min: 1 }) }, { n: 0 }).n, /at least 1/);
  assert.match(errs({ n: v.number({ max: 10 }) }, { n: 11 }).n, /at most 10/);
  for (const bad of [NaN, Infinity, 'abc', {}, []]) assert.ok(errs({ n: v.number() }, { n: bad }).n);
  assert.equal(parse({ n: v.number() }, { n: '2.5' }, { coerce: true }).value.n, 2.5);
});

test('boolean and enum', () => {
  assert.match(errs({ b: v.boolean() }, { b: 'true' }).b, /true or false/);
  assert.equal(parse({ b: v.boolean() }, { b: 'false' }, { coerce: true }).value.b, false);
  const role = { r: v.enum({ values: ['hr', 'employee'] }) };
  assert.equal(parse(role, { r: 'hr' }).value.r, 'hr');
  assert.match(errs(role, { r: 'admin' }).r, /one of: hr, employee/);
});

test('date and time reject impossible values', () => {
  assert.equal(errs({ d: v.date() }, { d: '2026-02-28' }), null);
  for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', 20260101]) assert.ok(errs({ d: v.date() }, { d: bad }), String(bad));
  assert.equal(errs({ t: v.time() }, { t: '09:00' }), null);
  for (const bad of ['24:00', '9:00', '09:60', '09:00:00']) assert.ok(errs({ t: v.time() }, { t: bad }), bad);
});

test('all field errors are reported together; non-object input is rejected', () => {
  const e = errs({ a: v.string({ required: true }), b: v.int({ required: true }) }, {});
  assert.deepEqual(Object.keys(e), ['a', 'b']);
  for (const bad of [null, 'text', 5, [], undefined]) assert.deepEqual(errs({ a: v.string() }, bad), { _: 'Expected an object' });
});

test('inherited and prototype keys are not read as input', () => {
  assert.deepEqual(errs({ constructor: v.string({ required: true }) }, {}), { constructor: 'Required' });
  const { value } = parse({ a: v.string() }, JSON.parse('{"__proto__":{"a":"x"},"a":"ok"}'));
  assert.deepEqual(value, { a: 'ok' });
  assert.equal({}.polluted, undefined);
});

// --- middleware, through a real Express pipeline ---
const app = express();
app.use(express.json());
app.post('/items', validate({ name: v.string({ required: true, max: 10 }), qty: v.int({ min: 1, default: 1 }) }),
  (req, res) => res.json(req.body));
app.get('/list', validate({ page: v.int({ min: 1, default: 1 }), active: v.boolean() }, 'query'),
  (req, res) => res.json(req.query));
app.post('/optional', validate({ note: v.string() }), (req, res) => res.json(req.body));
app.use(errorHandler);

test('bad body returns 400 validation with per-field errors', async () => {
  const res = await request(app).post('/items').send({ name: '', qty: 0 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'validation');
  assert.deepEqual(res.body.error.details.fields, { name: 'Required', qty: 'Must be at least 1' });
});

test('good body reaches the handler cleaned; extra keys are gone', async () => {
  const res = await request(app).post('/items').send({ name: ' Pen ', role: 'hr' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { name: 'Pen', qty: 1 });
});

test('query strings are coerced; bad values are rejected', async () => {
  const ok = await request(app).get('/list?page=3&active=true&junk=1');
  assert.deepEqual(ok.body, { page: 3, active: true });
  const bad = await request(app).get('/list?page=abc');
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.fields.page);
  assert.equal((await request(app).get('/list?page=1&page=2')).status, 400); // repeated param arrives as an array
});

test('a request with no body still works when every field is optional, and a JSON array body is rejected', async () => {
  assert.equal((await request(app).post('/optional')).status, 200);
  const res = await request(app).post('/items').send([1, 2]);
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error.details.fields, { _: 'Expected an object' });
});
