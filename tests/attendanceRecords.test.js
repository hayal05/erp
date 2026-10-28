// Task 2.17: HR attendance list (filters, pagination) and signed selfie links. Needs Postgres (TEST_DATABASE_URL).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { recordDeps } = await import('../src/routes/attendanceRecords.js');
const { hashPassword } = await import('../src/services/password.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'ann@natra.test', password: 'ann-password-123' };
const URL = '/api/attendance-records';
const PH_IN = 'natra/selfies/2026/' + 'i'.repeat(24);
const PH_OUT = 'natra/selfies/2026/' + 'o'.repeat(24);
let ann, bob, cat, deptA, deptB, rec = {};

const fakePhotos = { signedUrl: async (id) => ({ url: `https://signed.test/${id}?sig=abc`, expiresAt: new Date(Date.now() + 300_000).toISOString() }) };
recordDeps.photos = fakePhotos;
recordDeps.fillGaps = async () => null; // these tests count rows; gap filling has its own tests (attendanceGaps.test.js)

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [shift] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  deptA = Number((await query(`INSERT INTO departments (name) VALUES ('Sales') RETURNING id`)).rows[0].id);
  deptB = Number((await query(`INSERT INTO departments (name) VALUES ('Ops') RETURNING id`)).rows[0].id);
  const mkUser = async (c, name, role) => (await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [c.email, name, await hashPassword(c.password), role])).rows[0].id;
  await mkUser(HR, 'Hana HR', 'hr');
  const mkEmp = async (c, name, code, dept) => {
    const uid = await mkUser(c, name, 'employee');
    return (await query(`INSERT INTO employees (employee_code, user_id, department_id, start_date, shift_id) VALUES ($1,$2,$3,'2026-01-05',$4) RETURNING id`, [code, uid, dept, shift.id])).rows[0].id;
  };
  ann = Number(await mkEmp(EMP, 'Ann Employee', 'E-1', deptA));
  bob = Number(await mkEmp({ email: 'bob@natra.test', password: 'bob-password-123' }, 'Bob Builder', 'E-2', deptB));
  cat = Number(await mkEmp({ email: 'cat@natra.test', password: 'cat-password-123' }, 'Cat Clerk', 'E-3', null));
});
beforeEach(async () => {
  loginLimits.ip.clear(); loginLimits.pair.clear();
  if (skip) return;
  await query('DELETE FROM attendance_records'); await query('TRUNCATE audit_logs'); await query('DELETE FROM sessions');
  const ins = async (key, emp, date, extra = '', status = 'present', late = 0) => {
    rec[key] = Number((await query(
      `INSERT INTO attendance_records (employee_id, work_date, status, late_minutes, check_in_at${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ($1, $2, $3, $4, $2::date + time '09:00'${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`, [emp, date, status, late])).rows[0].id);
  };
  await ins('a1', ann, '2026-10-19', `check_in_photo_id='${PH_IN}'`);
  await ins('a2', ann, '2026-10-20', '', 'late', 15);
  await ins('b1', bob, '2026-10-19');
  await ins('b2', bob, '2026-10-21', '', 'late', 5);
  await ins('c1', cat, '2026-10-20');
  await query(`UPDATE attendance_records SET check_out_at = check_in_at + interval '8 hours', check_out_photo_id = $2 WHERE id = $1`, [rec.a1, PH_OUT]);
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const hr = () => signIn(app, HR);
const ids = (res) => res.body.items.map((r) => r.id);

test('anonymous 401, employee 403 on the list and on photo links', { skip }, async () => {
  const anon = await (await import('supertest')).default(app).get(URL);
  assert.equal(anon.status, 401);
  const emp = await signIn(app, EMP);
  assert.equal((await emp.get(URL)).status, 403);
  assert.equal((await emp.get(`${URL}/${rec.a1}/photos/check_in`)).status, 403);
});

test('a locked tablet session gets 423 on the list and on photo links', { skip }, async () => {
  const h = await hr();
  assert.equal((await h.post('/api/qr/lock').send({})).status, 200);
  assert.equal((await h.get(URL)).status, 423);
  assert.equal((await h.get(`${URL}/${rec.a1}/photos/check_in`)).status, 423);
});

test('list: contract, newest date first then name, and no photo ids or tokens in the payload', { skip }, async () => {
  const res = await (await hr()).get(URL);
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.page, res.body.pageSize, res.body.total], [1, 25, 5]);
  assert.deepEqual(ids(res), [rec.b2, rec.a2, rec.c1, rec.a1, rec.b1]);
  const a1 = res.body.items.find((r) => r.id === rec.a1);
  assert.deepEqual([a1.employeeCode, a1.fullName, a1.departmentName, a1.workDate, a1.status, a1.hasCheckInPhoto, a1.hasCheckOutPhoto],
    ['E-1', 'Ann Employee', 'Sales', '2026-10-19', 'present', true, true]);
  assert.ok(a1.checkInAt && a1.checkOutAt);
  assert.equal(res.body.items.find((r) => r.id === rec.b1).hasCheckInPhoto, false);
  assert.doesNotMatch(JSON.stringify(res.body), /natra\/selfies|photo_id|password|token/i);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('filters: single date, range, employee, department, status, and combinations', { skip }, async () => {
  const h = await hr();
  assert.deepEqual(ids(await h.get(`${URL}?from=2026-10-19&to=2026-10-19`)).sort(), [rec.a1, rec.b1].sort());
  assert.deepEqual(ids(await h.get(`${URL}?from=2026-10-20`)).sort(), [rec.a2, rec.b2, rec.c1].sort());
  assert.deepEqual(ids(await h.get(`${URL}?to=2026-10-19`)).sort(), [rec.a1, rec.b1].sort());
  assert.deepEqual(ids(await h.get(`${URL}?employeeId=${ann}`)), [rec.a2, rec.a1]);
  assert.deepEqual(ids(await h.get(`${URL}?departmentId=${deptB}`)), [rec.b2, rec.b1]);
  assert.deepEqual(ids(await h.get(`${URL}?status=late`)), [rec.b2, rec.a2]);
  assert.deepEqual(ids(await h.get(`${URL}?employeeId=${ann}&status=late&from=2026-10-20&to=2026-10-20`)), [rec.a2]);
  const none = await h.get(`${URL}?employeeId=${cat}&status=late`);
  assert.deepEqual([none.status, none.body.items, none.body.total], [200, [], 0]);
});

test('pagination: pages are disjoint, total is the full count, a page past the end is empty', { skip }, async () => {
  const h = await hr();
  const p1 = await h.get(`${URL}?pageSize=2&page=1`), p2 = await h.get(`${URL}?pageSize=2&page=2`), p3 = await h.get(`${URL}?pageSize=2&page=3`), p4 = await h.get(`${URL}?pageSize=2&page=4`);
  assert.deepEqual([p1.body.total, p2.body.total, p3.body.total], [5, 5, 5]);
  assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], [rec.b2, rec.a2, rec.c1, rec.a1, rec.b1]);
  assert.deepEqual([p4.body.items, p4.body.total], [[], 5]);
});

test('bad filters are 400 with field names; from after to is rejected', { skip }, async () => {
  const h = await hr();
  for (const [qs, field] of [['status=sick', 'status'], ['from=2026-02-30', 'from'], ['to=yesterday', 'to'], ['employeeId=abc', 'employeeId'],
    ['pageSize=1000', 'pageSize'], ['page=0', 'page'], ['employeeId=1&employeeId=2', 'employeeId']]) {
    const res = await h.get(`${URL}?${qs}`);
    assert.equal(res.status, 400, qs);
    assert.deepEqual(fieldsOf(res), [field], qs);
  }
  const bad = await h.get(`${URL}?from=2026-10-21&to=2026-10-19`);
  assert.deepEqual([bad.status, fieldsOf(bad)], [400, ['to']]);
});

test('SQL-looking filter values are just rejected or matched literally (parameterised)', { skip }, async () => {
  const h = await hr();
  assert.equal((await h.get(`${URL}?status=${encodeURIComponent("late' OR '1'='1")}`)).status, 400);
  assert.equal((await h.get(`${URL}?from=${encodeURIComponent("2026-10-19' OR 1=1 --")}`)).status, 400);
  assert.equal((await query('SELECT count(*)::int n FROM attendance_records')).rows[0].n, 5);
});

test('photo link: signed, expiring, audited, for check-in and check-out', { skip }, async () => {
  const h = await hr();
  const inn = await h.get(`${URL}/${rec.a1}/photos/check_in`);
  assert.equal(inn.status, 200);
  assert.match(inn.body.url, /^https:\/\/signed\.test\/.*sig=/);
  const left = new Date(inn.body.expiresAt).getTime() - Date.now();
  assert.ok(left > 0 && left <= 900_000, `expires in ${left} ms`);
  assert.equal(inn.headers['cache-control'], 'no-store');
  assert.match((await h.get(`${URL}/${rec.a1}/photos/check_out`)).body.url, new RegExp(PH_OUT));
  const { rows } = await query(`SELECT actor_user_id, action, entity_id, details FROM audit_logs WHERE action = 'attendance.photo_view' ORDER BY id`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].details, { kind: 'check_in', employeeId: ann });
  assert.doesNotMatch(JSON.stringify(rows), /natra\/selfies|sig=/); // the audit trail holds no photo id or URL
});

test('photo link errors: no photo 404, unknown record 404, bad kind/id 400, storage not configured 503', { skip }, async () => {
  const h = await hr();
  const none = await h.get(`${URL}/${rec.b1}/photos/check_in`);
  assert.deepEqual([none.status, errorCode(none)], [404, 'no_photo']);
  assert.equal((await h.get(`${URL}/${rec.a1}/photos/selfie`)).status, 400);
  assert.equal((await h.get(`${URL}/abc/photos/check_in`)).status, 400);
  assert.equal((await h.get(`${URL}/999999/photos/check_in`)).status, 404);
  assert.equal((await query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'attendance.photo_view'`)).rows[0].n, 0); // failures are not "views"
  recordDeps.photos = (await import('../src/services/cloudinary.js')).photos; // real service, no CLOUDINARY_* env
  try {
    const res = await h.get(`${URL}/${rec.a1}/photos/check_in`);
    assert.equal(res.status, 503); // (the handler reports every 5xx as code server_error by design)
    assert.equal((await query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'attendance.photo_view'`)).rows[0].n, 0);
  } finally { recordDeps.photos = fakePhotos; }
});

// ---------------------------------------------------------------- 2.18 corrections (PATCH /:id)
const row = async (id) => (await query('SELECT * FROM attendance_records WHERE id = $1', [id])).rows[0];
const auditRows = async (action = 'attendance.correct') => (await query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action])).rows;
const REASON = 'Forgot to scan, confirmed by supervisor';
const fix = (h, id, body) => h.patch(`${URL}/${id}`).send(body);
async function absentRow() {
  return Number((await query(`INSERT INTO attendance_records (employee_id, work_date, status) VALUES ($1, '2026-10-22', 'absent') RETURNING id`, [cat])).rows[0].id);
}

test('correction: anonymous 401, employee 403, locked tablet 423; nothing changes', { skip }, async () => {
  const anon = await (await import('supertest')).default(app).patch(`${URL}/${rec.a1}`).send({ reason: REASON, status: 'late' });
  assert.equal(anon.status, 401);
  assert.equal((await fix(await signIn(app, EMP), rec.a1, { reason: REASON, status: 'late' })).status, 403);
  const h = await hr();
  await h.post('/api/qr/lock').send({});
  assert.equal((await fix(h, rec.a1, { reason: REASON, status: 'late' })).status, 423);
  assert.equal((await row(rec.a1)).corrected_at, null);
  assert.equal((await auditRows()).length, 0);
});

test('correction needs a reason: missing, blank and too short are 400 on `reason`, nothing is written', { skip }, async () => {
  const h = await hr();
  for (const body of [{ status: 'late', lateMinutes: 5 }, { status: 'late', lateMinutes: 5, reason: '   ' }, { status: 'late', lateMinutes: 5, reason: 'ok' }]) {
    const res = await fix(h, rec.a1, body);
    assert.deepEqual([res.status, fieldsOf(res)], [400, ['reason']], JSON.stringify(body));
  }
  const r = await row(rec.a1);
  assert.deepEqual([r.status, r.corrected_at, r.correction_reason], ['present', null, null]);
  assert.equal((await auditRows()).length, 0);
});

test('correcting times: HH:MM is read in the company timezone, stamps and audit row are written', { skip }, async () => {
  const h = await hr();
  const res = await fix(h, rec.a1, { reason: REASON, checkInTime: '09:30', checkOutTime: '17:00' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.checkInTime, res.body.checkOutTime, res.body.status], ['09:30', '17:00', 'present']);
  const r = await row(rec.a1);
  assert.equal(r.check_in_at.toISOString(), '2026-10-19T06:30:00.000Z'); // Addis Ababa is UTC+3
  assert.equal(r.check_out_at.toISOString(), '2026-10-19T14:00:00.000Z');
  assert.equal(r.correction_reason, REASON);
  assert.ok(r.corrected_at);
  assert.equal(res.body.correctedByName, 'Hana HR');
  assert.equal(r.check_in_photo_id, PH_IN); // a correction never touches the selfies
  const [a] = await auditRows();
  assert.equal(a.reason, REASON);
  assert.deepEqual(Object.keys(a.details.changes).sort(), ['checkInAt', 'checkOutAt']);
  assert.equal(a.details.changes.checkInAt.to, '2026-10-19T06:30:00.000Z');
  assert.deepEqual([a.details.employeeId, a.details.workDate, String(a.entity_id)], [ann, '2026-10-19', String(rec.a1)]);
});

test('status to Late: minutes are recomputed from the shift unless given; Late back to Present zeroes them', { skip }, async () => {
  const h = await hr();
  const a = await fix(h, rec.a1, { reason: REASON, status: 'late', checkInTime: '09:40' }); // shift 09:00, grace 0
  assert.deepEqual([a.status, a.body.status, a.body.lateMinutes], [200, 'late', 40]);
  const b = await fix(h, rec.a1, { reason: REASON, lateMinutes: 7 });
  assert.deepEqual([b.status, b.body.lateMinutes], [200, 7]);
  const c = await fix(h, rec.b2, { reason: REASON, status: 'present' }); // b2 was late (5)
  assert.deepEqual([c.status, c.body.status, c.body.lateMinutes], [200, 'present', 0]);
});

test('editing only a time keeps the existing late minutes', { skip }, async () => {
  const res = await fix(await hr(), rec.a2, { reason: REASON, checkOutTime: '18:00' }); // a2: late, 15 minutes
  assert.deepEqual([res.status, res.body.status, res.body.lateMinutes, res.body.checkOutTime], [200, 'late', 15, '18:00']);
});

test('rules: Present/Late need a check-in, a check-out needs a check-in and must be later, Late needs minutes', { skip }, async () => {
  const h = await hr();
  const absent = await absentRow();
  const cases = [
    [absent, { status: 'present' }, ['checkInTime']],
    [absent, { status: 'late', lateMinutes: 10 }, ['checkInTime']],
    [absent, { checkOutTime: '17:00' }, ['checkOutTime']],
    [absent, { status: 'late', checkInTime: '09:00' }, ['lateMinutes']], // on time by the shift, so no minutes to derive
    [absent, { status: 'late', checkInTime: '09:30', lateMinutes: 0 }, ['lateMinutes']],
    [absent, { status: 'present', checkInTime: '09:00', lateMinutes: 5 }, ['lateMinutes']],
    [rec.a1, { checkInTime: '09:00', checkOutTime: '08:00' }, ['checkOutTime']],
    [rec.a1, { checkInTime: '09:00', checkOutTime: '09:00' }, ['checkOutTime']],
    [rec.a1, { checkInTime: null, status: 'present' }, ['checkInTime', 'checkOutTime']], // a1 still has a check-out: both rules fire
  ];
  for (const [id, body, fields] of cases) {
    const res = await fix(h, id, { reason: REASON, ...body });
    assert.deepEqual([res.status, fieldsOf(res)], [400, fields], JSON.stringify(body));
  }
  assert.equal((await auditRows()).length, 0);
  assert.equal((await row(rec.a1)).corrected_at, null);
});

test('an absent row can be corrected to present with a time; clearing a check-out is allowed', { skip }, async () => {
  const h = await hr();
  const absent = await absentRow();
  const ok = await fix(h, absent, { reason: REASON, status: 'present', checkInTime: '08:55' });
  assert.deepEqual([ok.status, ok.body.status, ok.body.checkInTime, ok.body.hasCheckInPhoto], [200, 'present', '08:55', false]);
  const clear = await fix(h, rec.a1, { reason: REASON, checkOutTime: null, status: 'incomplete' });
  assert.deepEqual([clear.status, clear.body.checkOutAt, clear.body.checkOutTime, clear.body.status], [200, null, null, 'incomplete']);
});

test('a correction that changes nothing is 400 no_change and writes no audit row or stamp', { skip }, async () => {
  const res = await fix(await hr(), rec.a2, { reason: REASON, status: 'late' });
  assert.deepEqual([res.status, errorCode(res)], [400, 'no_change']);
  assert.equal((await row(rec.a2)).corrected_at, null);
  assert.equal((await auditRows()).length, 0);
});

test('bad input: unknown id 404, bad id/time/status 400, other fields cannot be set (no mass assignment)', { skip }, async () => {
  const h = await hr();
  assert.equal((await fix(h, 999999, { reason: REASON, status: 'late', lateMinutes: 3 })).status, 404);
  assert.equal((await fix(h, 'abc', { reason: REASON, status: 'late' })).status, 400);
  for (const [body, field] of [[{ checkInTime: '25:99' }, 'checkInTime'], [{ checkOutTime: '9am' }, 'checkOutTime'], [{ status: 'sick' }, 'status'], [{ lateMinutes: -1 }, 'lateMinutes'], [{ lateMinutes: '5' }, 'lateMinutes']]) {
    const res = await fix(h, rec.a1, { reason: REASON, ...body });
    assert.deepEqual([res.status, fieldsOf(res)], [400, [field]], JSON.stringify(body));
  }
  const res = await fix(h, rec.a1, { reason: REASON, status: 'late', lateMinutes: 4, employeeId: bob, workDate: '2020-01-01', checkInPhotoId: 'x', correctedByUserId: 1 });
  assert.equal(res.status, 200);
  const r = await row(rec.a1);
  assert.deepEqual([Number(r.employee_id), r.work_date.toISOString().slice(0, 10), r.check_in_photo_id], [ann, '2026-10-19', PH_IN]);
});

test('each correction is audited; the record shows the latest, two simultaneous corrections both complete', { skip }, async () => {
  const h = await hr();
  assert.equal((await fix(h, rec.b1, { reason: 'first reason', status: 'late', lateMinutes: 12 })).status, 200);
  assert.equal((await fix(h, rec.b1, { reason: 'second reason', status: 'present' })).status, 200);
  const rows = await auditRows();
  assert.deepEqual(rows.map((r) => r.reason), ['first reason', 'second reason']);
  assert.equal((await row(rec.b1)).correction_reason, 'second reason');

  const [x, y] = await Promise.all([fix(h, rec.c1, { reason: 'one', checkInTime: '10:00' }), fix(h, rec.c1, { reason: 'two', checkInTime: '11:00' })]);
  assert.deepEqual([x.status, y.status], [200, 200]); // the row lock serialises them: no deadlock, no lost audit row
  assert.equal((await auditRows()).length, 4);
});

test('the list reports company-time strings and the company date', { skip }, async () => {
  const h = await hr();
  await fix(h, rec.a1, { reason: REASON, checkInTime: '09:05' });
  const res = await h.get(`${URL}?employeeId=${ann}&from=2026-10-19&to=2026-10-19`);
  assert.equal(res.body.items[0].checkInTime, '09:05');
  assert.match(res.body.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(res.body.items[0].correctionReason, REASON);
});
