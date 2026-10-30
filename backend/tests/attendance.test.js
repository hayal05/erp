// Task 2.20: spec 26 tests 7-11 end to end through the real app: expiry, replay, concurrency, no check-out before
// check-in, private selfies. Needs Postgres (TEST_DATABASE_URL). Finer-grained cases live in scan.test.js,
// attendanceScan.test.js and attendanceRecords.test.js; this file is the one place that states each spec test as a whole.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { tokenLimit } = await import('../src/routes/qr.js');
const { scanLimits, scanDeps } = await import('../src/routes/attendance.js');
const { recordDeps } = await import('../src/routes/attendanceRecords.js');
const { hashPassword } = await import('../src/services/password.js');
const { signIn, errorCode } = await import('./hrClient.js');
const { default: request } = await import('supertest');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const A = { email: 'ann@natra.test', password: 'ann-password-123' };
const B = { email: 'bob@natra.test', password: 'bob-password-123' };
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000)]).toString('base64');

const store = { uploaded: [], deleted: [] };
scanDeps.photos = {
  upload: async () => { const id = `natra/selfies/2026/${String(store.uploaded.length + 1).padStart(24, 's')}`; store.uploaded.push(id); return id; },
  delete: async (id) => { store.deleted.push(id); return 'ok'; },
};
recordDeps.photos = { signedUrl: async (id) => ({ url: `https://signed.test/${id}?sig=abc`, expiresAt: new Date(Date.now() + 300_000).toISOString() }) };
recordDeps.fillGaps = async () => null; // these tests count rows; gap filling has its own tests (attendanceGaps.test.js)

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [shift] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [A, 'Ann A', 'employee', 'E-1'], [B, 'Bob B', 'employee', 'E-2']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.email, name, await hashPassword(c.password), role]);
    if(role==='hr') await query("INSERT INTO access_grants(user_id,access_role) VALUES($1,'admin')",[u.id]);
    if (code) await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3)`, [code, u.id, shift.id]);
  }
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear(); tokenLimit.clear(); scanLimits.user.clear();
  store.uploaded.length = 0; store.deleted.length = 0;
  if (!skip) { await query('DELETE FROM attendance_records'); await query('DELETE FROM attendance_tokens'); }
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const newToken = async (hr) => (await hr.post('/api/qr/tokens').send({})).body.token;
const scan = (who, body) => who.post('/api/attendance/scan').send(body);
const records = async () => (await query('SELECT * FROM attendance_records ORDER BY id')).rows;

// ---- #7 Tokens expire
test('#7 a token lives about 45 seconds and is refused after it expires, with nothing recorded or uploaded', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  const issued = await hr.post('/api/qr/tokens').send({});
  assert.equal(issued.status, 201);
  assert.equal(issued.body.ttlSeconds, 45);
  const lifetime = (await query(`SELECT extract(epoch FROM expires_at - created_at)::int s FROM attendance_tokens`)).rows[0].s;
  assert.ok(lifetime >= 44 && lifetime <= 46, `lifetime was ${lifetime}s`);

  await query(`UPDATE attendance_tokens SET created_at = now() - interval '46 seconds', expires_at = now() - interval '1 second'`);
  const res = await scan(ann, { token: issued.body.token, photo: PHOTO });
  assert.equal(res.status, 410);
  assert.equal(errorCode(res), 'token_expired');
  assert.equal((await records()).length, 0);
  assert.equal(store.uploaded.length, 0);
  assert.equal((await query('SELECT count(*)::int n FROM attendance_tokens WHERE used_at IS NOT NULL')).rows[0].n, 0);
});

test('#7 issuing a new QR also ends the previous one from the same session', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  const first = await newToken(hr);
  await newToken(hr);
  assert.equal(errorCode(await scan(ann, { token: first, photo: PHOTO })), 'token_expired');
});

// Shared QR: per-employee replay protection, not global consumption.
test('#8 a shared QR accepts multiple employees but not a repeated employee', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A), bob = await signIn(app, B);
  const token = await newToken(hr);
  assert.equal((await scan(ann, { token, photo: PHOTO })).status, 201);
  const again = await scan(ann, { token, photo: PHOTO });
  assert.equal(again.status, 409);
  assert.equal(errorCode(again), 'token_already_scanned');
  assert.equal((await scan(bob, { token, photo: PHOTO })).status, 201);
  assert.equal((await records()).length, 2);
  assert.equal(store.uploaded.length, 2);
  assert.equal((await query('SELECT count(*)::int n FROM attendance_token_scans')).rows[0].n,2);
});

test('#9 two people scanning the same token at once: both succeed', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A), bob = await signIn(app, B);
  const token = await newToken(hr);
  const results = await Promise.all([scan(ann, { token, photo: PHOTO }), scan(bob, { token, photo: PHOTO })]);
  assert.deepEqual(results.map(r=>r.status), [201,201]);
  assert.equal((await records()).length, 2);
  assert.equal(store.uploaded.length-store.deleted.length,2);
});

test('#9 one person scanning twice at once with two tokens: a single check-in row, never two', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  const t1 = await newToken(hr);
  const hr2 = await signIn(app, HR); // second session = second live token
  const t2 = await newToken(hr2);
  await Promise.all([scan(ann, { token: t1, photo: PHOTO }), scan(ann, { token: t2, photo: PHOTO })]);
  const rows = await records();
  assert.equal(rows.length, 1); // attendance_one_per_day holds
  assert.ok(rows[0].check_in_at);
  assert.equal(store.uploaded.length - store.deleted.length, rows[0].check_out_at ? 2 : 1); // kept photos match the row
});

test('#9 the database itself refuses a second row for the same person and day', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  assert.equal((await scan(ann, { token: await newToken(hr), photo: PHOTO })).status, 201);
  await assert.rejects(query(`INSERT INTO attendance_records (employee_id, work_date, status) SELECT employee_id, work_date, 'absent' FROM attendance_records`), /attendance_one_per_day/);
});

// ---- #10 No check-out before check-in
test('#10 the first scan is always a check-in, whatever the client claims', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  const res = await scan(ann, { token: await newToken(hr), photo: PHOTO, action: 'check_out', checkOutAt: '2026-01-01T00:00:00Z' });
  assert.equal(res.status, 201);
  assert.equal(res.body.action, 'check_in');
  const [row] = await records();
  assert.ok(row.check_in_at);
  assert.equal(row.check_out_at, null);
});

test('#10 the database and the HR correction API both refuse a check-out without a check-in', { skip }, async () => {
  const hr = await signIn(app, HR);
  const emp = (await query(`SELECT id FROM employees WHERE employee_code = 'E-1'`)).rows[0].id;
  await assert.rejects(query(`INSERT INTO attendance_records (employee_id, work_date, check_out_at, status) VALUES ($1, '2026-10-20', now(), 'incomplete')`, [emp]));
  const { rows: [absent] } = await query(`INSERT INTO attendance_records (employee_id, work_date, status) VALUES ($1, '2026-10-21', 'absent') RETURNING id`, [emp]);
  const res = await hr.patch(`/api/attendance-records/${absent.id}`).send({ reason: 'Test correction', checkOutTime: '17:00' });
  assert.equal(res.status, 400);
  const row = (await query('SELECT check_in_at, check_out_at FROM attendance_records WHERE id = $1', [absent.id])).rows[0];
  assert.deepEqual([row.check_in_at, row.check_out_at], [null, null]);
});

// ---- #11 Selfies are not public
test('#11 selfie ids never appear in any employee-facing response, and the stored value is an id, not a URL', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  const out = await scan(ann, { token: await newToken(hr), photo: PHOTO });
  const mine = await ann.get('/api/attendance/mine');
  for (const body of [out.body, mine.body]) assert.doesNotMatch(JSON.stringify(body), /natra\/selfies|https?:|photo/i);
  const stored = (await records())[0].check_in_photo_id;
  assert.match(stored, /^natra\/selfies\/\d{4}\/[A-Za-z0-9_-]{24}$/);
  assert.doesNotMatch(stored, /^https?:/);
});

test('#11 only an unlocked HR session gets a signed link; employees, anonymous and a locked tablet do not', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  await scan(ann, { token: await newToken(hr), photo: PHOTO });
  const id = (await records())[0].id;
  const url = `/api/attendance-records/${id}/photos/check_in`;
  assert.equal((await request(app).get(url)).status, 401);
  assert.equal((await ann.get(url)).status, 403);
  const ok = await hr.get(url);
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /sig=/);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.ok(new Date(ok.body.expiresAt) - Date.now() <= 15 * 60_000);
  assert.equal((await hr.post('/api/qr/lock').send({})).status, 200);
  assert.equal((await hr.get(url)).status, 423);
});

test('#11 the HR list exposes only booleans for photos, and every photo view is audited without the photo id', { skip }, async () => {
  const hr = await signIn(app, HR), ann = await signIn(app, A);
  await scan(ann, { token: await newToken(hr), photo: PHOTO });
  const list = await hr.get('/api/attendance-records');
  assert.equal(list.body.items[0].hasCheckInPhoto, true);
  assert.doesNotMatch(JSON.stringify(list.body), /natra\/selfies/);
  const recordId = list.body.items[0].id;
  await hr.get(`/api/attendance-records/${recordId}/photos/check_in`);
  // audit_logs is append-only and shared by earlier tests, so look only at this record's rows
  const rows = (await query(`SELECT details FROM audit_logs WHERE action = 'attendance.photo_view' AND entity_id = $1`, [String(recordId)])).rows;
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /natra\/selfies|signed\.test/);
});
