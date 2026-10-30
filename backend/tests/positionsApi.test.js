// Task 6.3: positions API (list/create under a department, edit/delete by id). Needs Postgres (skipped without TEST_DATABASE_URL).
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
let hr, sales, ops, n = 0;
const POSITION = (over = {}) => ({ name: 'Cashier', basicMinor: 500000, allowanceMinor: 100000, ...over });
const audit = async (action, id) => (await query('SELECT * FROM audit_logs WHERE action = $1 AND entity_id = $2', [action, String(id)])).rows;
const create = (dept, body) => hr.post(`/api/departments/${dept}/positions`).send(body);
const hire = async (departmentId) => { n += 1; return (await hr.post('/api/employees').send({ employeeCode: `P${n}`, fullName: `Pos ${n}`, username: `p${n}@natra.test`, email: `p${n}@natra.test`, startDate: '2026-03-01', password: 'initial-password-1', departmentId })).body; };

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  loginLimits.ip.clear(); loginLimits.pair.clear();
  for (const [c, name, role] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee']]) {
    await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, $4)`, [c.email, name, await hashPassword(c.password), role]);
  }
  await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Standard', '09:00', '17:00')`);
  hr = await signIn(app, HR);
  sales = (await hr.post('/api/departments').send({ name: 'Sales' })).body.id;
  ops = (await hr.post('/api/departments').send({ name: 'Operations' })).body.id;
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

test('positions are HR-only: 401 anonymous, 403 employees, 423 for a locked tablet session', { skip }, async () => {
  const emp = await signIn(app, EMP);
  const calls = [['get', `/api/departments/${sales}/positions`], ['post', `/api/departments/${sales}/positions`], ['patch', '/api/positions/1'], ['delete', '/api/positions/1']];
  for (const [method, url] of calls) {
    assert.equal((await request(app)[method](url)).status, 401, `${method} ${url}`);
    assert.equal((await emp[method](url).send(POSITION())).status, 403, `${method} ${url}`);
  }
  const tablet = await signIn(app, HR);
  await tablet.post('/api/qr/lock').send({});
  for (const [method, url] of calls) assert.equal((await tablet[method](url).send(POSITION())).status, 423, `${method} ${url}`);
});

test('create: 201 with defaults, trimmed name, zero employees, audited; the department comes from the URL only', { skip }, async () => {
  const res = await create(sales, { name: '  Seller  ', basicMinor: 450000, allowanceMinor: 0, id: 99, departmentId: ops, employeeCount: 7 });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: res.body.id, departmentId: sales, name: 'Seller', basicMinor: 450000, allowanceMinor: 0,
    allowanceTaxable: true, allowancePensionable: true, pensionApplies: true, employeeCount: 0 });
  const [row] = await audit('position.create', res.body.id);
  assert.equal(row.details.departmentId, sales);
  assert.equal(row.details.name, 'Seller');
  assert.equal(row.details.basicMinor, 450000);
});

test('list: ordered by name, scoped to the department, searchable, paginated, with employee counts', { skip }, async () => {
  for (const name of ['Zeta Clerk', 'alpha Clerk', 'Mid Clerk']) await create(ops, POSITION({ name }));
  await create(sales, POSITION({ name: 'Elsewhere' }));
  const list = await hr.get(`/api/departments/${ops}/positions`);
  assert.deepEqual(list.body.items.map((p) => p.name), ['alpha Clerk', 'Mid Clerk', 'Zeta Clerk']);
  assert.deepEqual([list.body.total, list.body.page, list.body.pageSize], [3, 1, 25]);
  assert.ok(list.body.items.every((p) => p.departmentId === ops));
  assert.equal((await hr.get(`/api/departments/${ops}/positions?search=MID`)).body.total, 1);
  assert.equal((await hr.get(`/api/departments/${ops}/positions?search=100%25`)).body.total, 0); // % is literal, not a wildcard
  const page2 = await hr.get(`/api/departments/${ops}/positions?pageSize=2&page=2`);
  assert.deepEqual(page2.body.items.map((p) => p.name), ['Zeta Clerk']);
  assert.equal((await hr.get(`/api/departments/${ops}/positions?pageSize=500`)).status, 400);
  const target = list.body.items[0];
  await query('UPDATE employees SET department_id = $2, position_id = $3 WHERE id = $1', [(await hire(ops)).id, ops, target.id]);
  assert.equal((await hr.get(`/api/departments/${ops}/positions?search=alpha`)).body.items[0].employeeCount, 1);
});

test('validation: names, money and flags use the shared rules; unknown or malformed department ids', { skip }, async () => {
  const bad = (body) => create(sales, body);
  assert.deepEqual(fieldsOf(await bad({})), ['basicMinor', 'allowanceMinor', 'name'].sort());
  assert.deepEqual(fieldsOf(await bad(POSITION({ name: '   ' }))), ['name']);
  assert.deepEqual(fieldsOf(await bad(POSITION({ name: 'x'.repeat(101) }))), ['name']);
  assert.deepEqual(fieldsOf(await bad(POSITION({ basicMinor: -1 }))), ['basicMinor']);
  assert.deepEqual(fieldsOf(await bad(POSITION({ allowanceMinor: 1.5 }))), ['allowanceMinor']);
  assert.deepEqual(fieldsOf(await bad(POSITION({ pensionApplies: 'no' }))), ['pensionApplies']);
  assert.equal((await create(999999, POSITION())).status, 404);
  assert.equal((await hr.get('/api/departments/999999/positions')).status, 404);
  assert.equal((await hr.get('/api/departments/abc/positions')).status, 400);
  assert.equal((await hr.patch('/api/positions/abc').send(POSITION())).status, 400);
  assert.equal((await hr.patch('/api/positions/999999').send(POSITION())).status, 404);
  assert.equal((await hr.delete('/api/positions/999999')).status, 404);
});

test('duplicates: same name in a department (any case) is 409, another department may reuse it, rename collisions too', { skip }, async () => {
  const hrDept = (await hr.post('/api/departments').send({ name: 'People' })).body.id;
  const legal = (await hr.post('/api/departments').send({ name: 'Legal' })).body.id;
  const first = (await create(hrDept, POSITION({ name: 'Officer' }))).body;
  const dup = await create(hrDept, POSITION({ name: 'OFFICER' }));
  assert.deepEqual([dup.status, errorCode(dup), fieldsOf(dup)], [409, 'conflict', ['name']]);
  assert.equal((await create(legal, POSITION({ name: 'Officer' }))).status, 201);
  const other = (await create(hrDept, POSITION({ name: 'Manager' }))).body;
  assert.equal((await hr.patch(`/api/positions/${other.id}`).send(POSITION({ name: 'officer' }))).status, 409);
  assert.equal((await hr.patch(`/api/positions/${first.id}`).send(POSITION({ name: 'Officer', basicMinor: 1 }))).status, 200); // its own name is fine
});

test('edit: full replacement, only real changes are audited, a no-op writes nothing, the department cannot move', { skip }, async () => {
  const p = (await create(sales, POSITION({ name: 'Editable' }))).body;
  const res = await hr.patch(`/api/positions/${p.id}`).send({ name: 'Editable', basicMinor: 600000, allowanceMinor: 100000, allowanceTaxable: false, departmentId: ops });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.departmentId, res.body.basicMinor, res.body.allowanceTaxable, res.body.allowancePensionable], [sales, 600000, false, true]);
  const [row] = await audit('position.update', p.id);
  assert.deepEqual(Object.keys(row.details.changes).sort(), ['allowanceTaxable', 'basicMinor']);
  assert.deepEqual(row.details.changes.basicMinor, { from: 500000, to: 600000 });
  assert.equal('jobTitlesUpdated' in row.details, false);

  const stamp = (await query('SELECT updated_at FROM positions WHERE id = $1', [p.id])).rows[0].updated_at.getTime();
  assert.equal((await hr.patch(`/api/positions/${p.id}`).send({ name: 'Editable', basicMinor: 600000, allowanceMinor: 100000, allowanceTaxable: false })).status, 200);
  assert.equal((await audit('position.update', p.id)).length, 1);
  assert.equal((await query('SELECT updated_at FROM positions WHERE id = $1', [p.id])).rows[0].updated_at.getTime(), stamp);
  assert.equal((await hr.patch(`/api/positions/${p.id}`).send({ name: 'Editable' })).status, 400); // full body required
});

test('editing a position never changes salaries; renaming it moves the job title of its employees only', { skip }, async () => {
  const p = (await create(sales, POSITION({ name: 'Old Title' }))).body;
  const on = await hire(sales), off = await hire(sales);
  await query(`UPDATE employees SET position_id = $2, job_title = 'Old Title' WHERE id = $1`, [on.id, p.id]);
  await query(`UPDATE employees SET job_title = 'Hand written' WHERE id = $1`, [off.id]);
  await query('INSERT INTO salary_profiles (employee_id, basic_minor, allowance_minor) VALUES ($1, 777700, 1100)', [on.id]);
  const profile = async () => (await query('SELECT * FROM salary_profiles WHERE employee_id = $1', [on.id])).rows[0];
  const before = await profile();

  await hr.patch(`/api/positions/${p.id}`).send(POSITION({ name: 'New Title', basicMinor: 999999, allowanceMinor: 999999 }));
  const title = async (id) => (await query('SELECT job_title FROM employees WHERE id = $1', [id])).rows[0].job_title;
  assert.equal(await title(on.id), 'New Title');
  assert.equal(await title(off.id), 'Hand written');
  assert.deepEqual(await profile(), before); // salary profile untouched, updated_at included
  const [row] = await audit('position.update', p.id);
  assert.equal(row.details.jobTitlesUpdated, 1);
});

test('delete: an unused position is removed and audited; one an employee holds (even inactive) is a 409 until freed', { skip }, async () => {
  const free = (await create(sales, POSITION({ name: 'Free' }))).body;
  const used = (await create(sales, POSITION({ name: 'Used' }))).body;
  const emp = await hire(sales);
  await query('UPDATE employees SET position_id = $2 WHERE id = $1', [emp.id, used.id]);
  await hr.post(`/api/employees/${emp.id}/deactivate`).send({});
  const blocked = await hr.delete(`/api/positions/${used.id}`);
  assert.deepEqual([blocked.status, errorCode(blocked)], [409, 'in_use']);
  assert.ok((await hr.get(`/api/departments/${sales}/positions?search=Used`)).body.items.length === 1);
  assert.equal((await audit('position.delete', used.id)).length, 0);

  assert.equal((await hr.delete(`/api/positions/${free.id}`)).status, 204);
  assert.equal((await audit('position.delete', free.id)).length, 1);
  assert.equal((await hr.delete(`/api/positions/${free.id}`)).status, 404);

  await query('UPDATE employees SET position_id = NULL WHERE id = $1', [emp.id]);
  assert.equal((await hr.delete(`/api/positions/${used.id}`)).status, 204);
});
