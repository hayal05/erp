// Task 6.6: positions together with employees, salary profiles and payroll (cross-feature cases).
// The positions CRUD itself is in positionsApi.test.js and the department counts / delete guard in orgstructure.test.js.
// Needs Postgres (skipped without TEST_DATABASE_URL).
//
// The three positions created in before() are shared and must never be edited by a test: a test that edits, renames
// or deletes a position creates its own.
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
let hr, sales, ops, cashier, manager, driver, n = 0;

const CASHIER = { name: 'Cashier', basicMinor: 500000, allowanceMinor: 100000, allowanceTaxable: true, allowancePensionable: false, pensionApplies: true };
const MANAGER = { name: 'Manager', basicMinor: 900000, allowanceMinor: 250000, allowanceTaxable: false, allowancePensionable: true, pensionApplies: false };
const DRIVER = { name: 'Driver', basicMinor: 300000, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true };
const PACKAGE = (p) => ({ basicMinor: p.basicMinor, allowanceMinor: p.allowanceMinor, allowanceTaxable: p.allowanceTaxable, allowancePensionable: p.allowancePensionable, pensionApplies: p.pensionApplies });

const audit = async (action, id) => (await query('SELECT * FROM audit_logs WHERE action = $1 AND entity_id = $2 ORDER BY id', [action, String(id)])).rows;
const newPosition = async (departmentId, body) => { const res = await hr.post(`/api/departments/${departmentId}/positions`).send(body); assert.equal(res.status, 201, JSON.stringify(res.body)); return res.body; };
const hire = (o = {}) => { n += 1; return hr.post('/api/employees').send({gender:'male',dateOfBirth:'1990-01-01',fieldOfStudy:'Test study', employeeCode: `Q${n}`, fullName: `Qa ${n}`, username: `q${n}@natra.test`, email: `q${n}@natra.test`, startDate: '2026-03-01', password: 'initial-password-1', ...o }); };
const hired = async (o) => { const res = await hire(o); assert.equal(res.status, 201, JSON.stringify(res.body)); return res.body; };
const salary = async (employeeId) => { const { saved, employeeId: _id, ...rest } = (await hr.get(`/api/salary-profiles/${employeeId}`)).body; return { saved, ...rest }; };
const packageOf = async (employeeId) => { const { saved, ...rest } = await salary(employeeId); assert.equal(saved, true); return rest; };
const patch = (id, body) => hr.patch(`/api/employees/${id}`).send(body);
const get = async (id) => (await hr.get(`/api/employees/${id}`)).body;

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
  cashier = (await newPosition(sales, CASHIER)).id;
  manager = (await newPosition(sales, MANAGER)).id;
  driver = (await newPosition(ops, DRIVER)).id;
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

test('employees with a position: employee role is denied on create and update, and nothing is written', { skip }, async () => {
  const emp = await signIn(app, EMP);
  const start = (await query('SELECT count(*)::int AS n FROM employees')).rows[0].n;
  n += 1;
  const body = { employeeCode: `Q${n}`, fullName: 'Nope', username: `q${n}@natra.test`, email: `q${n}@natra.test`, startDate: '2026-03-01', password: 'initial-password-1', departmentId: sales, positionId: cashier };
  assert.equal((await emp.post('/api/employees').send(body)).status, 403);
  assert.equal((await request(app).post('/api/employees').send(body)).status, 401);
  const target = await hired({ departmentId: sales, positionId: cashier });
  assert.equal((await emp.patch(`/api/employees/${target.id}`).send({ positionId: manager, applyPositionSalary: true })).status, 403);
  assert.equal((await query('SELECT count(*)::int AS n FROM employees')).rows[0].n, start + 1); // only the HR-made one exists
  assert.deepEqual([(await get(target.id)).positionId, (await packageOf(target.id)).basicMinor], [cashier, CASHIER.basicMinor]);
});

test('create with a position copies the whole package, sets the job title, and audits both', { skip }, async () => {
  // Salary figures in the request are never read; only the position decides.
  const e = await hired({ departmentId: sales, positionId: manager, jobTitle: 'Ignored title', basicMinor: 1, allowanceMinor: 1 });
  assert.deepEqual([e.positionId, e.positionName, e.jobTitle, e.departmentId], [manager, 'Manager', 'Manager', sales]);
  assert.deepEqual(await packageOf(e.id), PACKAGE(MANAGER));
  assert.deepEqual([(await get(e.id)).positionId, (await get(e.id)).positionName], [manager, 'Manager']);

  const [created] = await audit('employee.create', e.id);
  assert.deepEqual([created.details.positionId, created.details.salaryApplied], [manager, true]);
  const profile = await audit('payroll.profile.create', e.id);
  assert.equal(profile.length, 1);
  assert.deepEqual(profile[0].details.source, { type: 'position', positionId: manager });
  const listed = (await hr.get(`/api/employees?search=${encodeURIComponent(e.email)}`)).body.items[0];
  assert.deepEqual([listed.positionId, listed.positionName], [manager, 'Manager']);
});

test('create without a position behaves exactly as before: no salary profile, free-text job title kept', { skip }, async () => {
  for (const extra of [{}, { positionId: null }]) {
    const e = await hired({ departmentId: sales, jobTitle: 'Accountant', ...extra });
    assert.deepEqual([e.positionId, e.positionName, e.jobTitle], [null, null, 'Accountant']);
    assert.equal((await salary(e.id)).saved, false);
    assert.equal((await audit('payroll.profile.create', e.id)).length, 0);
    assert.deepEqual([(await audit('employee.create', e.id))[0].details.positionId, (await audit('employee.create', e.id))[0].details.salaryApplied], [null, false]);
  }
});

test('create rejects an unknown position (400), another department\'s position or no department (422), and writes nothing', { skip }, async () => {
  const count = async () => (await query('SELECT (SELECT count(*) FROM employees)::int AS e, (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM salary_profiles)::int AS s')).rows[0];
  const start = await count();
  const unknown = await hire({ departmentId: sales, positionId: 999999 });
  assert.deepEqual([unknown.status, fieldsOf(unknown)], [400, ['positionId']]);
  const other = await hire({ departmentId: sales, positionId: driver }); // driver belongs to Operations
  assert.deepEqual([other.status, errorCode(other), fieldsOf(other)], [422, 'validation', ['positionId']]);
  const none = await hire({ positionId: cashier }); // no department chosen
  assert.deepEqual([none.status, fieldsOf(none)], [422, ['positionId']]);
  assert.deepEqual(await count(), start);
});

test('create is all-or-nothing: if saving the salary fails, no login, employee, audit row or salary is left', { skip }, async () => {
  n += 1;
  const body = { employeeCode: `Q${n}`, fullName: 'Rolled Back', username: `q${n}@natra.test`, email: `q${n}@natra.test`, startDate: '2026-03-01', password: 'initial-password-1', departmentId: sales, positionId: cashier };
  await query(`CREATE FUNCTION test_fail_salary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$`);
  await query('CREATE TRIGGER test_fail_salary BEFORE INSERT ON salary_profiles FOR EACH ROW EXECUTE FUNCTION test_fail_salary()');
  let status;
  try {
    status = (await hr.post('/api/employees').send(body)).status;
  } finally {
    await query('DROP TRIGGER test_fail_salary ON salary_profiles');
    await query('DROP FUNCTION test_fail_salary()');
  }
  assert.equal(status, 500);
  assert.equal((await query('SELECT count(*)::int AS n FROM users WHERE email = $1', [body.email])).rows[0].n, 0);
  assert.equal((await query('SELECT count(*)::int AS n FROM employees WHERE employee_code = $1', [body.employeeCode])).rows[0].n, 0);
  assert.equal((await query(`SELECT count(*)::int AS n FROM audit_logs WHERE details->>'employeeCode' = $1`, [body.employeeCode])).rows[0].n, 0);
  assert.equal((await hire({ departmentId: sales, positionId: cashier, employeeCode: body.employeeCode, username: body.email, email: body.email })).status, 201); // the code and email are free again
});

test('changing position with "Apply new position salary" replaces the salary, retitles, and audits before and after', { skip }, async () => {
  const e = await hired({ departmentId: sales, positionId: cashier });
  const res = await patch(e.id, { positionId: manager, applyPositionSalary: true });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.positionId, res.body.positionName, res.body.jobTitle], [manager, 'Manager', 'Manager']);
  assert.deepEqual(await packageOf(e.id), PACKAGE(MANAGER));

  const [row] = await audit('employee.update', e.id);
  assert.deepEqual([row.details.positionId, row.details.salaryApplied], [manager, true]);
  assert.deepEqual(row.details.changes.positionId, { from: cashier, to: manager });
  assert.deepEqual(row.details.changes.jobTitle, { from: 'Cashier', to: 'Manager' });
  const [salaryRow] = await audit('payroll.profile.update', e.id);
  assert.deepEqual(salaryRow.details.source, { type: 'position', positionId: manager });
  assert.deepEqual(salaryRow.details.changes.basicMinor, { from: CASHIER.basicMinor, to: MANAGER.basicMinor });
});

test('declining the checkbox (false or omitted) keeps the current salary, including a hand-edited one', { skip }, async () => {
  for (const extra of [{ applyPositionSalary: false }, {}]) {
    const e = await hired({ departmentId: sales, positionId: cashier });
    const manual = { basicMinor: 612300, allowanceMinor: 4500, allowanceTaxable: false, allowancePensionable: false, pensionApplies: true };
    assert.equal((await hr.put(`/api/salary-profiles/${e.id}`).send(manual)).status, 200);
    const res = await patch(e.id, { positionId: manager, ...extra });
    assert.deepEqual([res.status, res.body.positionId, res.body.jobTitle], [200, manager, 'Manager']);
    assert.deepEqual(await packageOf(e.id), manual);
    assert.equal((await audit('payroll.profile.update', e.id)).length, 1); // only the manual edit
    assert.equal((await audit('employee.update', e.id))[0].details.salaryApplied, false);
    // Repeating the same request changes nothing and writes no second employee.update row.
    assert.equal((await patch(e.id, { positionId: manager, ...extra })).status, 200);
    assert.equal((await audit('employee.update', e.id)).length, 1);
  }
});

test('a manual salary edit after creation works, is audited, and stays personal: position and colleagues are untouched', { skip }, async () => {
  const a = await hired({ departmentId: sales, positionId: cashier });
  const b = await hired({ departmentId: sales, positionId: cashier });
  const edit = { ...PACKAGE(CASHIER), basicMinor: 555000, allowanceMinor: 0 };
  assert.equal((await hr.put(`/api/salary-profiles/${a.id}`).send(edit)).status, 200);
  assert.deepEqual(await packageOf(a.id), edit);
  assert.deepEqual(await packageOf(b.id), PACKAGE(CASHIER));
  const [row] = await audit('payroll.profile.update', a.id);
  assert.deepEqual(row.details.changes.basicMinor, { from: CASHIER.basicMinor, to: 555000 });
  assert.equal('source' in row.details, false); // a hand edit carries no position marker
  assert.deepEqual([(await get(a.id)).positionId, (await get(a.id)).jobTitle], [cashier, 'Cashier']);
  const listed = (await hr.get(`/api/departments/${sales}/positions?search=Cashier`)).body.items[0];
  assert.deepEqual(PACKAGE(listed), PACKAGE(CASHIER));
  assert.equal(listed.employeeCount >= 2, true);
});

test('editing a position later leaves everyone already on it alone; only new assignments get the new package', { skip }, async () => {
  const own = await newPosition(sales, { name: 'Template', basicMinor: 100000, allowanceMinor: 5000 });
  const early = await hired({ departmentId: sales, positionId: own.id });
  const original = await packageOf(early.id);
  const rows = async () => JSON.stringify((await query('SELECT * FROM salary_profiles WHERE employee_id = $1', [early.id])).rows);
  const snapshot = await rows();

  const res = await hr.patch(`/api/positions/${own.id}`).send({ name: 'Template', basicMinor: 777000, allowanceMinor: 99000, allowanceTaxable: false });
  assert.equal(res.status, 200);
  assert.deepEqual(await packageOf(early.id), original);
  assert.equal(await rows(), snapshot); // the row itself, updated_at included

  const late = await hired({ departmentId: sales, positionId: own.id });
  assert.deepEqual([(await packageOf(late.id)).basicMinor, (await packageOf(late.id)).allowanceTaxable], [777000, false]);
  // Re-sending the same position with apply = true is the explicit "reset to position salary".
  assert.equal((await patch(early.id, { positionId: own.id, applyPositionSalary: true })).status, 200);
  assert.equal((await packageOf(early.id)).basicMinor, 777000);
});

test('clearing the position keeps the salary and the last title; a title in the same request is honored', { skip }, async () => {
  const a = await hired({ departmentId: sales, positionId: manager });
  const cleared = await patch(a.id, { positionId: null });
  assert.deepEqual([cleared.status, cleared.body.positionId, cleared.body.positionName, cleared.body.jobTitle, cleared.body.departmentId], [200, null, null, 'Manager', sales]);
  assert.deepEqual(await packageOf(a.id), PACKAGE(MANAGER));
  assert.equal((await patch(a.id, { jobTitle: 'Consultant' })).body.jobTitle, 'Consultant'); // free text again

  const b = await hired({ departmentId: sales, positionId: manager });
  const both = await patch(b.id, { positionId: null, jobTitle: 'Freelancer' });
  assert.deepEqual([both.body.positionId, both.body.jobTitle], [null, 'Freelancer']);
  assert.deepEqual(await packageOf(b.id), PACKAGE(MANAGER));
});

test('changing department: a position of the new department can be chosen in the same request, otherwise the position is cleared', { skip }, async () => {
  // Moved without choosing a position in the new department: cleared, salary and title kept.
  const a = await hired({ departmentId: sales, positionId: cashier });
  const moved = await patch(a.id, { departmentId: ops });
  assert.deepEqual([moved.status, moved.body.departmentId, moved.body.positionId, moved.body.positionName, moved.body.jobTitle], [200, ops, null, null, 'Cashier']);
  assert.deepEqual(await packageOf(a.id), PACKAGE(CASHIER));

  // Moved and given a position of the new department at once.
  const b = await hired({ departmentId: sales, positionId: cashier });
  const both = await patch(b.id, { departmentId: ops, positionId: driver, applyPositionSalary: true });
  assert.deepEqual([both.status, both.body.departmentId, both.body.positionId, both.body.jobTitle], [200, ops, driver, 'Driver']);
  assert.deepEqual(await packageOf(b.id), PACKAGE(DRIVER));

  // Removing the department clears the position too (the database requires a department for a position).
  const c = await hired({ departmentId: sales, positionId: cashier });
  const none = await patch(c.id, { departmentId: null });
  assert.deepEqual([none.status, none.body.departmentId, none.body.positionId], [200, null, null]);
});

test('a position from another department is 422 on update and changes nothing; so is a position without a department', { skip }, async () => {
  const e = await hired({ departmentId: sales, positionId: cashier });
  const unchanged = JSON.stringify(await get(e.id));
  for (const body of [{ positionId: driver }, { positionId: driver, applyPositionSalary: true }, { departmentId: ops, positionId: cashier }]) {
    const res = await patch(e.id, body);
    assert.deepEqual([res.status, errorCode(res), fieldsOf(res)], [422, 'validation', ['positionId']], JSON.stringify(body));
  }
  assert.equal((await patch(e.id, { positionId: 999999 })).status, 400);
  assert.equal(JSON.stringify(await get(e.id)), unchanged);
  assert.deepEqual(await packageOf(e.id), PACKAGE(CASHIER));

  const free = await hired({}); // no department at all
  const res = await patch(free.id, { positionId: cashier });
  assert.deepEqual([res.status, fieldsOf(res)], [422, ['positionId']]);
  // Directly in the database the same mismatch is refused too (backstop behind the API check).
  await assert.rejects(query('UPDATE employees SET position_id = $2 WHERE id = $1', [e.id, driver]), /employees_position_department_fkey/);
});

test('the position owns the job title and a salary is never replaced by accident', { skip }, async () => {
  const e = await hired({ departmentId: sales, positionId: cashier });
  const edits = (await audit('employee.update', e.id)).length;
  const ignored = await patch(e.id, { jobTitle: 'Hand typed' });
  assert.deepEqual([ignored.status, ignored.body.jobTitle], [200, 'Cashier']);
  assert.equal((await audit('employee.update', e.id)).length, edits);

  const manual = { ...PACKAGE(CASHIER), basicMinor: 1 };
  await hr.put(`/api/salary-profiles/${e.id}`).send(manual);
  for (const body of [{ applyPositionSalary: true }, { positionId: null, applyPositionSalary: true }, { phone: '0911000000', applyPositionSalary: true }]) {
    const res = await patch(e.id, body);
    assert.deepEqual([res.status, fieldsOf(res)], [422, ['applyPositionSalary']], JSON.stringify(body));
  }
  assert.equal((await patch(e.id, { applyPositionSalary: 'true' })).status, 400); // a real boolean only
  assert.deepEqual(await packageOf(e.id), manual);
});

test('a position in use cannot be deleted; once the employee is cleared it can', { skip }, async () => {
  const own = await newPosition(ops, { name: 'Short Lived', basicMinor: 100000, allowanceMinor: 0 });
  const e = await hired({ departmentId: ops, positionId: own.id });
  const blocked = await hr.delete(`/api/positions/${own.id}`);
  assert.deepEqual([blocked.status, errorCode(blocked)], [409, 'in_use']);
  assert.equal((await hr.delete(`/api/departments/${ops}`)).status, 409);
  assert.equal((await patch(e.id, { positionId: null })).status, 200);
  assert.equal((await hr.delete(`/api/positions/${own.id}`)).status, 204);
  assert.deepEqual(await packageOf(e.id), { basicMinor: 100000, allowanceMinor: 0, allowanceTaxable: true, allowancePensionable: true, pensionApplies: true }); // the salary outlives the position
});

test('an approved payroll never changes after position, salary or assignment edits; the next draft uses the new salary', { skip }, async () => {
  const flags = (await query('SELECT absence_deduction_enabled AS a, unpaid_leave_deduction_enabled AS u FROM payroll_settings')).rows[0];
  await query('UPDATE payroll_settings SET absence_deduction_enabled = false, unpaid_leave_deduction_enabled = false');
  await query('TRUNCATE income_tax_brackets RESTART IDENTITY CASCADE');
  await query('INSERT INTO income_tax_brackets (from_minor, rate, fixed_deduction_minor) VALUES (0, 15, 15000)');
  try {
    const own = await newPosition(sales, { name: 'Payroll Position', basicMinor: 400000, allowanceMinor: 20000 });
    const e = await hired({ departmentId: sales, positionId: own.id });
    // Payroll needs a salary profile for every active employee; keep this test to the one employee.
    await query(`UPDATE employees SET status = 'inactive' WHERE id <> $1`, [e.id]);

    const october = await hr.post('/api/payroll/periods').send({ month: '2026-10' });
    assert.equal(october.status, 201, JSON.stringify(october.body));
    assert.equal((await hr.post(`/api/payroll/periods/${october.body.id}/approve`).send({})).status, 200);
    const snapshot = async () => JSON.stringify({
      period: (await query('SELECT * FROM payroll_periods WHERE id = $1', [october.body.id])).rows,
      entries: (await query('SELECT * FROM payroll_entries WHERE period_id = $1 ORDER BY id', [october.body.id])).rows,
      items: (await query('SELECT i.* FROM payroll_entry_items i JOIN payroll_entries x ON x.id = i.entry_id WHERE x.period_id = $1 ORDER BY i.id', [october.body.id])).rows,
    });
    const approved = await snapshot();
    const entry = (await hr.get(`/api/payroll/periods/${october.body.id}/entries`)).body.items[0];
    assert.deepEqual([entry.employeeId, entry.basicMinor, entry.allowanceMinor], [e.id, 400000, 20000]);

    // Every kind of change this phase introduces.
    assert.equal((await hr.patch(`/api/positions/${own.id}`).send({ name: 'Payroll Position Renamed', basicMinor: 800000, allowanceMinor: 60000 })).status, 200);
    assert.equal((await patch(e.id, { positionId: manager, applyPositionSalary: true })).status, 200);
    assert.equal((await hr.put(`/api/salary-profiles/${e.id}`).send({ ...PACKAGE(MANAGER), basicMinor: 910000 })).status, 200);
    assert.equal((await patch(e.id, { departmentId: ops })).status, 200); // clears the position
    assert.equal(await snapshot(), approved);
    assert.deepEqual((await hr.get(`/api/payroll/periods/${october.body.id}/entries`)).body.items[0], entry);

    // A draft generated afterwards reads the employee's current salary.
    const november = await hr.post('/api/payroll/periods').send({ month: '2026-11' });
    assert.equal(november.status, 201, JSON.stringify(november.body));
    const next = (await hr.get(`/api/payroll/periods/${november.body.id}/entries`)).body.items[0];
    assert.deepEqual([next.basicMinor, next.allowanceMinor], [910000, MANAGER.allowanceMinor]);
    assert.equal(await snapshot(), approved); // generating November did not touch October either
  } finally {
    await query('UPDATE payroll_settings SET absence_deduction_enabled = $1, unpaid_leave_deduction_enabled = $2', [flags.a, flags.u]);
  }
});
