// Tasks 2.12-2.16: POST /api/attendance/scan (auth, validation, active check, token validation, check-in/out, status). Needs Postgres.
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
const { hashPassword } = await import('../src/services/password.js');
const { companyDate } = await import('../src/services/attendance.js');
const { isoWeekday } = await import('../src/services/attendanceStatus.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
const NOREC = { email: 'norec@natra.test', password: 'norec-password-123' };
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000)]).toString('base64');
const FAKE_TOKEN = 'Z'.repeat(43);

// In-memory photo store standing in for Cloudinary.
const store = { uploaded: [], deleted: [], failUpload: false };
scanDeps.photos = {
  upload: async () => {
    if (store.failUpload) throw Object.assign(new Error('storage down'), { status: 502, code: 'storage_failed' });
    const id = `natra/selfies/2026/${String(store.uploaded.length + 1).padStart(24, 's')}`;
    store.uploaded.push(id); return id;
  },
  delete: async (id) => { store.deleted.push(id); return 'ok'; },
};

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [shift] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  for (const [c, name, role] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee'], [NOREC, 'No Record', 'employee']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.email, name, await hashPassword(c.password), role]);
    if (c !== HR && c !== NOREC) await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ('E-1', $1, '2026-01-05', $2)`, [u.id, shift.id]);
  }
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear(); tokenLimit.clear(); scanLimits.user.clear();
  store.uploaded.length = 0; store.deleted.length = 0; store.failUpload = false; // a failed test must not poison the next one
  if (!skip) { await query('DELETE FROM attendance_records'); await query('DELETE FROM attendance_tokens'); }
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const newToken = async (hr) => (await hr.post('/api/qr/tokens').send({})).body.token;
const scan = (emp, body) => emp.post('/api/attendance/scan').send(body);
const setup = async () => { const hr = await signIn(app, HR); const emp = await signIn(app, EMP); return { hr, emp, token: await newToken(hr) }; };
const setActive = (status) => query(`UPDATE employees SET status = $1`, [status]);

test('anonymous gets 401 and HR gets 403 (employees only)', { skip }, async () => {
  const { hr, token } = await setup();
  const anon = await (await import('supertest')).default(app).post('/api/attendance/scan').send({ token, photo: PHOTO });
  assert.equal(anon.status, 401);
  const asHr = await scan(hr, { token, photo: PHOTO });
  assert.equal(asHr.status, 403);
  assert.equal(errorCode(asHr), 'forbidden');
});

test('bad requests are 400 with field messages and never touch the token', { skip }, async () => {
  const { emp, token } = await setup();
  const cases = [[{ photo: PHOTO }, ['token']], [{ token }, ['photo']], [{ token, photo: 'not base64!' }, ['photo']],
    [{ token, photo: Buffer.from('GIF89a').toString('base64') }, ['photo']], [{ token: 'short', photo: PHOTO }, ['token']], [{}, ['photo', 'token']]];
  for (const [body, fields] of cases) {
    const res = await scan(emp, body);
    assert.equal(res.status, 400);
    assert.deepEqual(fieldsOf(res), fields);
  }
  assert.equal((await query('SELECT count(*)::int n FROM attendance_tokens WHERE used_at IS NOT NULL')).rows[0].n, 0);
});

test('an unknown token is rejected (400 invalid_token)', { skip }, async () => {
  const { emp } = await setup();
  const res = await scan(emp, { token: FAKE_TOKEN, photo: PHOTO });
  assert.equal(res.status, 400);
  assert.equal(errorCode(res), 'invalid_token');
});

test('an expired token is rejected (410 token_expired)', { skip }, async () => {
  const { emp, token } = await setup();
  await query(`UPDATE attendance_tokens SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'`);
  const res = await scan(emp, { token, photo: PHOTO });
  assert.equal(res.status, 410);
  assert.equal(errorCode(res), 'token_expired');
});

test('a used token is rejected (409 token_used)', { skip }, async () => {
  const { emp, token } = await setup();
  await query(`UPDATE attendance_tokens SET used_at = now(), used_by_employee_id = (SELECT id FROM employees LIMIT 1)`);
  const res = await scan(emp, { token, photo: PHOTO });
  assert.equal(res.status, 409);
  assert.equal(errorCode(res), 'token_used');
});

test('a token whose issuing HR session has ended is rejected', { skip }, async () => {
  const { hr, emp, token } = await setup();
  assert.equal((await hr.post('/api/auth/logout').send({})).status, 204); // cascades the session's tokens away
  assert.equal(errorCode(await scan(emp, { token, photo: PHOTO })), 'invalid_token');
  // and the expired-session variant: the row survives, the issuer no longer counts
  const second = await setup();
  await query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id IN (SELECT issued_by_session_id FROM attendance_tokens)`);
  assert.equal(errorCode(await scan(second.emp, { token: second.token, photo: PHOTO })), 'invalid_token');
});

test('a token from a deactivated HR user is rejected', { skip }, async () => {
  const { emp, token } = await setup();
  await query(`UPDATE users SET is_active = false WHERE role = 'hr'`);
  try { assert.equal(errorCode(await scan(emp, { token, photo: PHOTO })), 'invalid_token'); }
  finally { await query(`UPDATE users SET is_active = true WHERE role = 'hr'`); }
});

test('an inactive employee is refused (403) even with a good token; so is a user with no employee record', { skip }, async () => {
  const { emp, token } = await setup();
  await setActive('inactive');
  try {
    const res = await scan(emp, { token, photo: PHOTO });
    assert.equal(res.status, 403);
    assert.equal(errorCode(res), 'employee_inactive');
  } finally { await setActive('active'); }
  const norec = await signIn(app, NOREC);
  const res = await scan(norec, { token, photo: PHOTO });
  assert.equal(res.status, 403);
  assert.equal(errorCode(res), 'no_employee_record');
});

// 2.16: the status now comes from the shift and the DB clock, so tests pin the shift instead of depending on the time of day.
const setShift = (start, grace, days) => query(`UPDATE shifts SET start_time = $1, end_time = '23:59', grace_minutes = $2, work_days = $3::smallint[]`, [start, grace, days]);
const restoreShift = () => query(`UPDATE shifts SET start_time = '09:00', end_time = '17:00', grace_minutes = 0, work_days = '{1,2,3,4,5}'`);
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

test('a valid scan is a check-in: 201 with the confirmation, token consumed, photo kept', { skip }, async () => {
  const { emp, token } = await setup();
  const today = isoWeekday(companyDate());
  await setShift('09:00', 0, ALL_DAYS.filter((d) => d !== today)); // today is a day off: present, 0 minutes, at any hour
  const res = await scan(emp, { token, photo: PHOTO });
  await restoreShift();
  assert.equal(res.status, 201);
  assert.equal(res.body.action, 'check_in');
  assert.equal(res.body.status, 'present');
  assert.equal(res.body.lateMinutes, 0);
  assert.deepEqual(res.body.employee, { fullName: 'Eli Employee', employeeCode: 'E-1' });
  assert.match(res.body.workDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(res.body.at && res.body.checkInAt && res.body.checkOutAt === null);
  // 2.19: HH:MM in the company timezone for the confirmation screen (the phone's zone is never used)
  assert.match(res.body.atTime, /^\d{2}:\d{2}$/);
  assert.equal(res.body.checkInTime, res.body.atTime);
  assert.equal(res.body.checkOutTime, null);
  assert.doesNotMatch(JSON.stringify(res.body), /natra\/selfies|token/i); // no photo id, no token in the response
  assert.equal((await query('SELECT count(*)::int n FROM attendance_tokens WHERE used_at IS NOT NULL')).rows[0].n, 1);
  assert.equal((await query('SELECT check_in_photo_id FROM attendance_records')).rows[0].check_in_photo_id, store.uploaded[0]);
  assert.equal(store.deleted.length, 0);
});

test('a check-in after the shift start + grace is stored as late with the minutes (shift started 00:00 today)', { skip }, async () => {
  const { emp, token } = await setup();
  await setShift('00:00', 0, ALL_DAYS);
  try {
    const res = await scan(emp, { token, photo: PHOTO });
    assert.equal(res.status, 201);
    // Only a scan in the first second after midnight could be 'present' here.
    assert.equal(res.body.status, 'late');
    assert.ok(res.body.lateMinutes >= 1 && res.body.lateMinutes <= 1440);
    const row = (await query('SELECT status, late_minutes FROM attendance_records')).rows[0];
    assert.deepEqual([row.status, row.late_minutes], ['late', res.body.lateMinutes]);
  } finally { await restoreShift(); }
});

test('a check-out keeps the check-in status and late minutes', { skip }, async () => {
  const { hr, emp, token } = await setup();
  await setShift('00:00', 0, ALL_DAYS);
  try {
    const inn = await scan(emp, { token, photo: PHOTO });
    const out = await scan(emp, { token: await newToken(hr), photo: PHOTO });
    assert.equal(out.body.action, 'check_out');
    assert.deepEqual([out.body.status, out.body.lateMinutes], [inn.body.status, inn.body.lateMinutes]);
  } finally { await restoreShift(); }
});

test('second scan is the check-out; a third is refused (409) WITHOUT uploading a photo', { skip }, async () => {
  const { hr, emp, token } = await setup();
  assert.equal((await scan(emp, { token, photo: PHOTO })).status, 201);
  const out = await scan(emp, { token: await newToken(hr), photo: PHOTO });
  assert.equal(out.status, 201);
  assert.equal(out.body.action, 'check_out');
  assert.ok(out.body.checkOutAt);
  assert.match(out.body.checkOutTime, /^\d{2}:\d{2}$/);
  assert.equal(out.body.atTime, out.body.checkOutTime);
  const before = store.uploaded.length;
  const third = await scan(emp, { token: await newToken(hr), photo: PHOTO });
  assert.equal(third.status, 409);
  assert.equal(errorCode(third), 'already_checked_out');
  assert.equal(store.uploaded.length, before);
  assert.equal((await query('SELECT count(*)::int n FROM attendance_records')).rows[0].n, 1);
});

test('when the selfie upload fails: 502, no attendance, token still usable', { skip }, async () => {
  const { emp, token } = await setup();
  store.failUpload = true;
  const res = await scan(emp, { token, photo: PHOTO });
  assert.equal(res.status, 502);
  assert.equal((await query('SELECT count(*)::int n FROM attendance_records')).rows[0].n, 0);
  assert.equal((await query('SELECT count(*)::int n FROM attendance_tokens WHERE used_at IS NULL')).rows[0].n, 1);
  store.failUpload = false;
  assert.equal((await scan(emp, { token, photo: PHOTO })).status, 201); // same token works on retry
});

test('a token issued by a LOCKED tablet session is still accepted', { skip }, async () => {
  const { hr, emp, token } = await setup();
  assert.equal((await hr.post('/api/qr/lock').send({})).status, 200);
  assert.equal((await scan(emp, { token, photo: PHOTO })).status, 201);
});

test('repeated bad tokens are throttled per user (429 + Retry-After)', { skip }, async () => {
  const { emp, token } = await setup();
  for (let i = 0; i < 10; i++) assert.equal((await scan(emp, { token: FAKE_TOKEN, photo: PHOTO })).status, 400);
  const blocked = await scan(emp, { token, photo: PHOTO }); // even a good token is refused while blocked
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
});

test('this route takes a large body (selfie) while other routes keep the 100 kb limit', { skip }, async () => {
  const { emp, token } = await setup();
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400 * 1024)]).toString('base64'); // ~530 KB of base64
  assert.equal((await scan(emp, { token: FAKE_TOKEN, photo: big })).status, 400); // parsed fine, rejected as a bad token
  assert.equal(errorCode(await scan(emp, { token, photo: 'A'.repeat(2_000_000) })), 'too_large'); // over the route cap
  const login = await emp.post('/api/auth/login').send({ email: 'x@y.z', password: 'p'.repeat(150_000) });
  assert.equal(login.status, 413);
});

// ---- 2.13: next action and duplicate guard (today = company-timezone date from the database clock)
const TODAY = `(now() AT TIME ZONE 'Africa/Addis_Ababa')::date`;
const addRecord = (cols, vals) => query(
  `INSERT INTO attendance_records (employee_id, work_date, ${cols}) VALUES ((SELECT id FROM employees LIMIT 1), ${TODAY}, ${vals})`);
const unusedTokens = async () => (await query('SELECT count(*)::int n FROM attendance_tokens WHERE used_at IS NULL')).rows[0].n;

test('2.13: a day that is already complete (in and out) rejects another scan with 409', { skip }, async () => {
  const { emp, token } = await setup();
  await addRecord('check_in_at, check_out_at, status', `now() - interval '8 hours', now() - interval '1 hour', 'present'`);
  const res = await scan(emp, { token, photo: PHOTO });
  assert.equal(res.status, 409);
  assert.equal(errorCode(res), 'already_checked_out');
  assert.equal(await unusedTokens(), 1); // refused, so the code was not burned
  assert.equal(store.uploaded.length, 0); // and no selfie was uploaded for a scan that cannot succeed
  assert.equal((await query('SELECT count(*)::int n FROM attendance_records')).rows[0].n, 1);
});

test('2.13: approved leave is refused; an absent row without check-in still allows check-in', { skip }, async () => {
  const { emp, token } = await setup();
  await addRecord('status', `'on_leave'`);
  assert.equal(errorCode(await scan(emp, { token, photo: PHOTO })), 'on_leave');
  await query(`UPDATE attendance_records SET status = 'absent'`);
  assert.equal((await scan(emp, { token, photo: PHOTO })).status, 201);
});

test('2.13: only the signed-in employee\'s own record counts (another employee\'s record does not block)', { skip }, async () => {
  const { emp, token } = await setup();
  const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('other@natra.test','Other','x','employee') RETURNING id`);
  const { rows: [e2] } = await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ('E-2', $1, '2026-01-05', (SELECT id FROM shifts LIMIT 1)) RETURNING id`, [u.id]);
  await query(`INSERT INTO attendance_records (employee_id, work_date, check_in_at, check_out_at, status) VALUES ($1, ${TODAY}, now() - interval '8 hours', now() - interval '1 hour', 'present')`, [e2.id]);
  try { assert.equal((await scan(emp, { token, photo: PHOTO })).status, 201); }
  finally { await query('DELETE FROM attendance_records'); await query('DELETE FROM employees WHERE id = $1', [e2.id]); await query('DELETE FROM users WHERE id = $1', [u.id]); }
});
