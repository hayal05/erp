import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { default: request } = await import('supertest');
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { hashPassword } = await import('../src/services/password.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
let hr;
let n = 0;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  loginLimits.ip.clear(); loginLimits.pair.clear();
  for (const [c, name, role] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee']]) {
    await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, $4)`, [c.email, name, await hashPassword(c.password), role]);
  }
  // The migration seeds a 'Standard' shift, but TRUNCATE removed it; restore it so new employees get a default shift.
  await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Standard', '09:00', '17:00')`);
  hr = await signIn(app, HR);
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const audit = async (action, id) => (await query('SELECT * FROM audit_logs WHERE action = $1 AND entity_id = $2', [action, String(id)])).rows;
const hire = (departmentId, shiftId) => { n += 1; return hr.post('/api/employees').send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study', employeeCode: `O${n}`, fullName: `Org ${n}`, username: `o${n}@natra.test`, email: `o${n}@natra.test`,
  startDate: '2026-03-01', password: 'initial-password-1', departmentId, shiftId }); };

test('departments and shifts are HR-only: 401 anonymous, 403 employees', { skip }, async () => {
  const emp = await signIn(app, EMP);
  for (const base of ['/api/departments', '/api/shifts']) {
    assert.equal((await request(app).get(base)).status, 401, base);
    assert.equal((await emp.get(base)).status, 403, base);
    assert.equal((await emp.post(base).send({ name: 'Sneaky', startTime: '09:00', endTime: '10:00' })).status, 403, base);
    assert.equal((await emp.get(`${base}/1`)).status, 403, base);
    assert.equal((await emp.patch(`${base}/1`).send({ name: 'Sneaky' })).status, 403, base);
    assert.equal((await emp.delete(`${base}/1`)).status, 403, base);
  }
});

test('departments: create, list with employee counts, rename, search, paginate', { skip }, async () => {
  const created = await hr.post('/api/departments').send({ name: '  Finance  ' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { id: created.body.id, name: 'Finance', employeeCount: 0, positionCount: 0 });
  assert.equal((await audit('department.create', created.body.id)).length, 1);

  for (const name of ['Sales East', 'Sales West', 'Sales North']) await hr.post('/api/departments').send({ name });
  const list = await hr.get('/api/departments');
  assert.deepEqual([list.body.page, list.body.pageSize, list.body.total], [1, 25, 4]);
  assert.deepEqual(list.body.items.map((d) => d.name), ['Finance', 'Sales East', 'Sales North', 'Sales West']);
  assert.match(list.headers['cache-control'], /no-store/);

  const page2 = await hr.get('/api/departments?search=sales&pageSize=2&page=2');
  assert.deepEqual([page2.body.items.length, page2.body.total], [1, 3]);
  assert.equal((await hr.get('/api/departments?pageSize=500')).status, 400);

  await hire(created.body.id);
  assert.equal((await hr.get('/api/departments?search=finance')).body.items[0].employeeCount, 1);

  const renamed = await hr.patch(`/api/departments/${created.body.id}`).send({ name: 'Finance & Accounts' });
  assert.deepEqual([renamed.status, renamed.body.name, renamed.body.employeeCount], [200, 'Finance & Accounts', 1]);
  assert.deepEqual((await audit('department.update', created.body.id))[0].details.changes.name, { from: 'Finance', to: 'Finance & Accounts' });
});

test('departments: duplicate names (any case), blank names and bad ids are rejected', { skip }, async () => {
  await hr.post('/api/departments').send({ name: 'Legal' });
  const dup = await hr.post('/api/departments').send({ name: 'LEGAL' });
  assert.deepEqual([dup.status, errorCode(dup), ...fieldsOf(dup)], [409, 'conflict', 'name']);
  assert.deepEqual([(await hr.post('/api/departments').send({ name: '   ' })).status, (await hr.post('/api/departments').send({})).status], [400, 400]);
  assert.equal((await hr.patch('/api/departments/999999').send({ name: 'x' })).status, 404);
  assert.equal((await hr.patch('/api/departments/abc').send({ name: 'x' })).status, 400);
  const other = (await hr.post('/api/departments').send({ name: 'Ops' })).body;
  assert.equal((await hr.patch(`/api/departments/${other.id}`).send({ name: 'legal' })).status, 409);
});

test('departments: an unused one can be deleted, one with employees (even inactive) cannot', { skip }, async () => {
  const used = (await hr.post('/api/departments').send({ name: 'In Use' })).body;
  const free = (await hr.post('/api/departments').send({ name: 'Free' })).body;
  const emp = (await hire(used.id)).body;
  await hr.post(`/api/employees/${emp.id}/deactivate`).send({});
  const blocked = await hr.delete(`/api/departments/${used.id}`);
  assert.deepEqual([blocked.status, errorCode(blocked)], [409, 'in_use']);
  assert.equal((await hr.get('/api/departments?search=in%20use')).body.total, 1);

  assert.equal((await hr.delete(`/api/departments/${free.id}`)).status, 204);
  assert.equal((await audit('department.delete', free.id)).length, 1);
  assert.equal((await hr.delete(`/api/departments/${free.id}`)).status, 404);
});

test('departments: list and detail carry positionCount; detail 404s and rejects bad ids (task 6.4)', { skip }, async () => {
  const dept = (await hr.post('/api/departments').send({ name: 'Counted' })).body;
  const other = (await hr.post('/api/departments').send({ name: 'Counted Elsewhere' })).body;
  assert.equal(dept.positionCount, 0);
  for (const name of ['Clerk', 'Lead']) assert.equal((await hr.post(`/api/departments/${dept.id}/positions`).send({ name, basicMinor: 100000, allowanceMinor: 0 })).status, 201);
  await hr.post(`/api/departments/${other.id}/positions`).send({ name: 'Clerk', basicMinor: 100000, allowanceMinor: 0 });
  await hire(dept.id);

  const detail = await hr.get(`/api/departments/${dept.id}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body, { id: dept.id, name: 'Counted', employeeCount: 1, positionCount: 2 });
  assert.match(detail.headers['cache-control'], /no-store/);
  const row = (await hr.get('/api/departments?search=counted')).body.items.find((d) => d.id === dept.id);
  assert.deepEqual([row.employeeCount, row.positionCount], [1, 2]);
  assert.equal((await hr.get(`/api/departments/${other.id}`)).body.positionCount, 1); // positions of another department are not counted
  const renamed = await hr.patch(`/api/departments/${dept.id}`).send({ name: 'Counted Dept' });
  assert.deepEqual([renamed.body.employeeCount, renamed.body.positionCount], [1, 2]); // write responses carry the counts too

  assert.equal((await hr.get('/api/departments/999999')).status, 404);
  assert.equal((await hr.get('/api/departments/abc')).status, 400);
  assert.equal((await request(app).get(`/api/departments/${dept.id}`)).status, 401);
});

test('departments: delete is refused while positions exist, with its own message, and works once they are gone (task 6.4)', { skip }, async () => {
  const dept = (await hr.post('/api/departments').send({ name: 'Has Positions' })).body;
  const pos = (await hr.post(`/api/departments/${dept.id}/positions`).send({ name: 'Analyst', basicMinor: 200000, allowanceMinor: 0 })).body;

  const blocked = await hr.delete(`/api/departments/${dept.id}`);
  assert.deepEqual([blocked.status, errorCode(blocked)], [409, 'in_use']);
  assert.match(blocked.body.error.message, /positions/i);
  assert.equal((await audit('department.delete', dept.id)).length, 0);
  assert.equal((await hr.get(`/api/departments/${dept.id}`)).body.positionCount, 1); // nothing was removed

  assert.equal((await hr.delete(`/api/positions/${pos.id}`)).status, 204);
  assert.equal((await hr.delete(`/api/departments/${dept.id}`)).status, 204);
  assert.equal((await audit('department.delete', dept.id)).length, 1);
});

test('departments: with both positions and employees, the positions message wins; employees still block afterwards (task 6.4)', { skip }, async () => {
  const dept = (await hr.post('/api/departments').send({ name: 'Both' })).body;
  const pos = (await hr.post(`/api/departments/${dept.id}/positions`).send({ name: 'Rep', basicMinor: 100000, allowanceMinor: 0 })).body;
  await hire(dept.id);
  const first = await hr.delete(`/api/departments/${dept.id}`);
  assert.equal(first.status, 409);
  assert.match(first.body.error.message, /positions/i);

  await hr.delete(`/api/positions/${pos.id}`);
  const second = await hr.delete(`/api/departments/${dept.id}`);
  assert.equal(second.status, 409);
  assert.match(second.body.error.message, /employees/i);
});

test('shifts: create with defaults, list ordered by start time, patch, audit', { skip }, async () => {
  const late = await hr.post('/api/shifts').send({ name: 'Late', startTime: '13:00', endTime: '21:30', graceMinutes: 15, workDays: [6, 1, 3] });
  assert.equal(late.status, 201);
  assert.deepEqual(late.body, { id: late.body.id, name: 'Late', startTime: '13:00', endTime: '21:30', graceMinutes: 15, workDays: [1, 3, 6], employeeCount: 0 });
  const early = await hr.post('/api/shifts').send({ name: 'Early', startTime: '07:00', endTime: '15:00' });
  assert.deepEqual([early.body.graceMinutes, early.body.workDays], [0, [1, 2, 3, 4, 5]]);
  assert.equal((await audit('shift.create', late.body.id)).length, 1);

  const list = await hr.get('/api/shifts');
  assert.deepEqual(list.body.items.map((s) => s.name), ['Early', 'Standard', 'Late']);
  assert.deepEqual([list.body.total, list.body.page, list.body.pageSize], [3, 1, 25]);

  const patched = await hr.patch(`/api/shifts/${late.body.id}`).send({ endTime: '22:00', workDays: [1, 2, 3, 4, 5, 6, 7], graceMinutes: 5 });
  assert.deepEqual([patched.status, patched.body.endTime, patched.body.workDays, patched.body.graceMinutes, patched.body.startTime], [200, '22:00', [1, 2, 3, 4, 5, 6, 7], 5, '13:00']);
  const rows = await audit('shift.update', late.body.id);
  assert.deepEqual(Object.keys(rows[0].details.changes).sort(), ['endTime', 'graceMinutes', 'workDays']);
  assert.equal((await hr.patch(`/api/shifts/${late.body.id}`).send({ name: 'Late' })).status, 200);
  assert.equal((await audit('shift.update', late.body.id)).length, 1); // no-op, not audited again
});

test('shifts: same-day rule, weekdays, grace limits, duplicates and empty patches are rejected', { skip }, async () => {
  const base = { name: 'Rule', startTime: '09:00', endTime: '17:00' };
  const bad = async (override, status, field) => {
    const res = await hr.post('/api/shifts').send({ ...base, ...override });
    assert.deepEqual([res.status, ...fieldsOf(res)], [status, field], JSON.stringify(override));
  };
  await bad({ endTime: '09:00' }, 400, 'endTime');   // zero length
  await bad({ endTime: '08:00' }, 400, 'endTime');   // overnight shifts are not supported in the MVP
  await bad({ startTime: '9am' }, 400, 'startTime');
  await bad({ workDays: [] }, 400, 'workDays');
  await bad({ workDays: [1, 1] }, 400, 'workDays');
  await bad({ workDays: [0, 8] }, 400, 'workDays');
  await bad({ graceMinutes: 241 }, 400, 'graceMinutes');
  await bad({ graceMinutes: -1 }, 400, 'graceMinutes');

  const ok = (await hr.post('/api/shifts').send(base)).body;
  const dup = await hr.post('/api/shifts').send({ ...base, name: 'RULE' });
  assert.deepEqual([dup.status, ...fieldsOf(dup)], [409, 'name']);
  const mid = await hr.patch(`/api/shifts/${ok.id}`).send({ startTime: '18:00' }); // would end before it starts
  assert.deepEqual([mid.status, ...fieldsOf(mid)], [400, 'endTime']);
  assert.equal((await hr.get('/api/shifts')).body.items.find((s) => s.id === ok.id).startTime, '09:00'); // unchanged
  assert.equal((await hr.patch(`/api/shifts/${ok.id}`).send({})).status, 400);
  assert.equal((await hr.patch('/api/shifts/999999').send({ name: 'x' })).status, 404);
});

test('shifts: a shift assigned to employees cannot be deleted; an unused one can', { skip }, async () => {
  const used = (await hr.post('/api/shifts').send({ name: 'Used', startTime: '05:00', endTime: '06:00' })).body;
  const free = (await hr.post('/api/shifts').send({ name: 'Unused', startTime: '05:30', endTime: '06:30' })).body;
  const emp = (await hire(undefined, used.id)).body;
  assert.equal(emp.shiftName, 'Used');
  assert.equal((await hr.get('/api/shifts')).body.items.find((s) => s.id === used.id).employeeCount, 1);

  const blocked = await hr.delete(`/api/shifts/${used.id}`);
  assert.deepEqual([blocked.status, errorCode(blocked)], [409, 'in_use']);
  assert.equal((await hr.delete(`/api/shifts/${free.id}`)).status, 204);
  assert.equal((await audit('shift.delete', free.id)).length, 1);
  assert.equal((await hr.delete(`/api/shifts/${free.id}`)).status, 404);

  // Moving the employee to another shift releases the first one.
  const other = (await hr.get('/api/shifts')).body.items.find((s) => s.name === 'Early');
  assert.equal((await hr.patch(`/api/employees/${emp.id}`).send({ shiftId: other.id })).body.shiftId, other.id);
  assert.equal((await hr.delete(`/api/shifts/${used.id}`)).status, 204);
});
