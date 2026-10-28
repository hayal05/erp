import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
process.env.FRONTEND_URL = 'http://localhost:5173';
const { pool, query, withTransaction } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { app } = await import('../src/server.js');
const { loginLimits } = await import('../src/routes/auth.js');
const { signIn, errorCode, fieldsOf } = await import('./hrClient.js');
const { hashPassword } = await import('../src/services/password.js');

const HR = { email: 'hr@natra.test', password: 'hr-password-123' };
const EMP = { email: 'emp@natra.test', password: 'emp-password-123' };
const URL = '/api/payroll/periods';
let empId, otherId;
const audits = async (action) => (await query('SELECT count(*)::int AS n FROM audit_logs WHERE action = $1', [action])).rows[0].n;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [s] } = await query(`INSERT INTO shifts (name, start_time, end_time, work_days) VALUES ('Day','09:00','17:00','{1,2,3,4,5}') RETURNING id`);
  const ids = [];
  for (const [c, name, role, code] of [[HR, 'Hana HR', 'hr'], [EMP, 'Eli Employee', 'employee', 'E-1'], [{ email: 'two@natra.test', password: 'two-password-123' }, 'Two Employee', 'employee', 'E-2']]) {
    const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [c.email, name, await hashPassword(c.password), role]);
    if (code) ids.push((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3) RETURNING id`, [code, u.id, s.id])).rows[0].id);
  }
  [empId, otherId] = ids.map(Number);
});
beforeEach(async () => { loginLimits.ip.clear(); loginLimits.pair.clear(); if (!skip) {
 await query('UPDATE payroll_settings SET absence_deduction_enabled=false, unpaid_leave_deduction_enabled=false');
 await query('TRUNCATE attendance_records, leave_requests, holidays, audit_logs, payroll_periods, deduction_items, salary_profiles, income_tax_brackets RESTART IDENTITY CASCADE');
 await query(`INSERT INTO income_tax_brackets (from_minor, rate, fixed_deduction_minor) VALUES (0,15,15000)`);
 await query(`INSERT INTO salary_profiles (employee_id, basic_minor, allowance_minor) VALUES ($1,250000,10000), ($2,100000,0)`, [empId, otherId]);
 } });
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });



test('payroll: anonymous, employees and locked tablets cannot generate or read payroll', { skip }, async () => {
  const request = (await import('supertest')).default;
  assert.equal((await request(app).get(URL)).status, 401);
  const emp = await signIn(app, EMP);
  for (const suffix of ['', '/1', '/1/entries']) assert.equal((await emp.get(URL + suffix)).status, 403);
  assert.equal((await emp.post(URL).send({ month: '2026-10' })).status, 403);
  const hr = await signIn(app, HR);
  await hr.post('/api/qr/lock').send({});
  assert.equal((await hr.post(URL).send({ month: '2026-10' })).status, 423);
  assert.equal((await hr.get(URL)).status, 423);
});
test('payroll: draft persists engine amounts, active employees only, deductions and audit', { skip }, async () => {
  await query("UPDATE employees SET status='inactive' WHERE id=$1", [otherId]);
  try {
    await query(`INSERT INTO deduction_items (employee_id,kind,name,amount_minor,recurring) VALUES ($1,'advance','Once',2000,false), ($1,'loan','Monthly',5000,true), ($1,'penalty','Disabled',3000,false)`, [empId]);
    await query("UPDATE deduction_items SET enabled=false WHERE name='Disabled'");
    const hr = await signIn(app, HR);
    const created = await hr.post(URL).send({ month: '2026-10', status: 'paid', netMinor: 1 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'draft');
    assert.equal(created.body.employeeCount, 1);
    const id = created.body.id;
    assert.equal((await hr.get(`${URL}/${id}`)).body.month, '2026-10');
    const entries = (await hr.get(`${URL}/${id}/entries?pageSize=1`)).body;
    assert.equal(entries.total, 1);
    assert.equal(entries.items[0].netMinor, 218000);
    assert.equal(entries.items[0].employeeId, empId);
    assert.equal((await query('SELECT count(*)::int n FROM payroll_entry_items')).rows[0].n, 2);
    const items = (await query('SELECT name, applied_period_id FROM deduction_items ORDER BY id')).rows;
    assert.equal(Number(items[0].applied_period_id), id);
    assert.equal(items[1].applied_period_id, null);
    assert.equal(await audits('payroll.period.generate'), 1);
    assert.equal((await hr.post(URL).send({ month: '2026-10' })).status, 409);
    assert.equal((await hr.get(URL)).body.total, 1);
    const next = await hr.post(URL).send({ month: '2026-11' });
    assert.equal(next.status, 201);
    assert.equal((await hr.get(`${URL}/${next.body.id}/entries`)).body.items[0].otherDeductionsMinor, 5000);
  } finally { await query("UPDATE employees SET status='active' WHERE id=$1", [otherId]); }
});
test('payroll: invalid month, missing profiles, invalid brackets and empty staff do not create periods', { skip }, async () => {
  const hr = await signIn(app, HR);
  assert.equal((await hr.post(URL).send({ month: '2026-13' })).status, 400);
  await query('DELETE FROM salary_profiles WHERE employee_id=$1', [otherId]);
  assert.equal((await hr.post(URL).send({ month: '2026-10' })).body.error.code, 'missing_profiles');
  await query('DELETE FROM income_tax_brackets');
  assert.equal((await hr.post(URL).send({ month: '2026-10' })).body.error.code, 'invalid_brackets');
  assert.equal((await query('SELECT count(*)::int n FROM payroll_periods')).rows[0].n, 0);
});
test('payroll: a late database failure rolls back entries, period, audit and one-time consumption', { skip }, async () => {
  const hr = await signIn(app, HR);
  await query(`INSERT INTO deduction_items (employee_id,kind,name,amount_minor) VALUES ($1,'advance','Once',2000)`, [empId]);
  // Fail the second employee's entry after the first employee's one-time item has been consumed.
  await query(`CREATE FUNCTION test_fail_payroll_entry() RETURNS trigger AS $$ BEGIN IF NEW.employee_id = ${otherId} THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await query('CREATE TRIGGER test_fail_payroll BEFORE INSERT ON payroll_entries FOR EACH ROW EXECUTE FUNCTION test_fail_payroll_entry()');
  try {
    assert.equal((await hr.post(URL).send({ month: '2026-10' })).status, 500);
    for (const table of ['payroll_periods','payroll_entries','payroll_entry_items']) assert.equal((await query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
    assert.equal((await query('SELECT applied_period_id FROM deduction_items')).rows[0].applied_period_id, null);
    assert.equal(await audits('payroll.period.generate'), 0);
  } finally {
    await query('DROP TRIGGER test_fail_payroll ON payroll_entries');
    await query('DROP FUNCTION test_fail_payroll_entry()');
  }
});
test('payroll: concurrent creation never duplicates a month or consumes an item twice', { skip }, async () => {
  const a = await signIn(app, HR), b = await signIn(app, HR);
  await query(`INSERT INTO deduction_items (employee_id,kind,name,amount_minor) VALUES ($1,'advance','Once',2000)`, [empId]);
  const results = await Promise.all([a.post(URL).send({ month: '2026-10' }), b.post(URL).send({ month: '2026-10' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201,409]);
  assert.equal((await query('SELECT count(*)::int n FROM payroll_periods')).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::int n FROM payroll_entry_items WHERE kind='advance'")).rows[0].n, 1);
});

test('draft edit: recalculates salary, keeps consumed deduction and profile, audits each recalculation', { skip }, async () => {
  const hr = await signIn(app, HR);
  await query(`INSERT INTO deduction_items (employee_id,kind,name,amount_minor) VALUES ($1,'advance','Once',2000)`, [empId]);
  const period = (await hr.post(URL).send({ month: '2026-10' })).body;
  const entry = (await hr.get(`${URL}/${period.id}/entries`)).body.items.find((e) => e.employeeId === empId);
  const path = `${URL}/${period.id}/entries/${entry.id}`;
  const edit = await hr.patch(path).send({ basicMinor: 300000, netMinor: 1 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.netMinor, 263000);
  assert.equal(edit.body.allowanceMinor, 10000);
  assert.equal(edit.body.otherDeductionsMinor, 2000);
  assert.equal(Number((await query('SELECT basic_minor FROM salary_profiles WHERE employee_id=$1', [empId])).rows[0].basic_minor), 250000);
  assert.equal(Number((await query('SELECT applied_period_id FROM deduction_items')).rows[0].applied_period_id), period.id);
  await hr.patch(path).send({ basicMinor: 300000 });
  assert.equal((await query("SELECT count(*)::int n FROM payroll_entry_items WHERE entry_id=$1 AND kind='advance'", [entry.id])).rows[0].n, 1);
  assert.equal(await audits('payroll.entry.recalculate'), 2);
});
test('draft edit: permission, lock, validation and entry-period isolation', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  const entry = (await hr.get(`${URL}/${p.id}/entries`)).body.items[0];
  const path = `${URL}/${p.id}/entries/${entry.id}`;
  assert.equal((await emp.patch(path).send({ basicMinor: 1 })).status, 403);
  for (const body of [{ basicMinor: -1 }, { allowanceMinor: 0.1 }, { netMinor: 1 }, {}]) assert.equal((await hr.patch(path).send(body)).status, 400);
  assert.equal((await hr.patch(`${URL}/${p.id}/entries/999999`).send({ basicMinor: 1 })).status, 404);
  const p2 = (await hr.post(URL).send({ month: '2026-11' })).body;
  assert.equal((await hr.patch(`${URL}/${p2.id}/entries/${entry.id}`).send({ basicMinor: 1 })).status, 404);
  await hr.post('/api/qr/lock').send({});
  assert.equal((await hr.patch(path).send({ basicMinor: 1 })).status, 423);
});
test('draft edit: invalid config rolls back and approved/paid periods remain unchanged', { skip }, async () => {
  const hr = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  const entry = (await hr.get(`${URL}/${p.id}/entries`)).body.items[0];
  const path = `${URL}/${p.id}/entries/${entry.id}`;
  await query('DELETE FROM income_tax_brackets');
  assert.equal((await hr.patch(path).send({ basicMinor: 1 })).status, 422);
  assert.equal(Number((await query('SELECT basic_minor FROM payroll_entries WHERE id=$1', [entry.id])).rows[0].basic_minor), entry.basicMinor);
  assert.equal(await audits('payroll.entry.recalculate'), 0);
  const actor = (await query("SELECT id FROM users WHERE role='hr'")).rows[0].id;
  await query("UPDATE payroll_periods SET status='approved', config_snapshot='{}', approved_at=now(), approved_by_user_id=$2 WHERE id=$1", [p.id, actor]);
  assert.equal((await hr.patch(path).send({ basicMinor: 1 })).status, 409);
  await query("UPDATE payroll_periods SET status='paid', paid_on='2026-10-31', paid_by_user_id=$2 WHERE id=$1", [p.id, actor]);
  assert.equal((await hr.patch(path).send({ basicMinor: 1 })).status, 409);
  assert.equal(await audits('payroll.entry.recalculate'), 0);
});
test('draft edit: breakdown write failure rolls back updated totals and audit', { skip }, async () => {
  const hr = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  const entry = (await hr.get(`${URL}/${p.id}/entries`)).body.items[0];
  await query("INSERT INTO other_taxes (name,rate,base) VALUES ('Test tax',1,'gross')");
  await query("CREATE FUNCTION test_fail_payroll_item() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql");
  await query('CREATE TRIGGER test_fail_payroll_item BEFORE INSERT ON payroll_entry_items FOR EACH ROW EXECUTE FUNCTION test_fail_payroll_item()');
  try {
    const res = await hr.patch(`${URL}/${p.id}/entries/${entry.id}`).send({ basicMinor: 300000 });
    assert.equal(res.status, 500);
    const unchanged = (await hr.get(`${URL}/${p.id}/entries`)).body.items.find((e) => e.id === entry.id);
    assert.deepEqual(unchanged, entry);
    assert.equal(await audits('payroll.entry.recalculate'), 0);
  } finally {
    await query('DROP TRIGGER test_fail_payroll_item ON payroll_entry_items');
    await query('DROP FUNCTION test_fail_payroll_item()');
    await query("DELETE FROM other_taxes WHERE name='Test tax'");
  }
});

test('approval: snapshot and amounts survive later settings/profile changes and reject all edits', { skip }, async () => {
  const hr = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  const entries = (await hr.get(`${URL}/${p.id}/entries`)).body.items;
  const approved = await hr.post(`${URL}/${p.id}/approve`).send({ status: 'paid', configSnapshot: {} });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'approved');
  const snapshot = (await hr.get(`${URL}/${p.id}`)).body.configSnapshot;
  assert.equal(snapshot.entries.length, entries.length);
  assert.equal(snapshot.entries[0].netMinor, entries[0].netMinor);
  await query('UPDATE payroll_settings SET employee_pension_rate=9');
  await query('UPDATE salary_profiles SET basic_minor=99999, pension_applies=false');
  try {
    assert.deepEqual((await hr.get(`${URL}/${p.id}/entries`)).body.items, entries);
    assert.deepEqual((await hr.get(`${URL}/${p.id}`)).body.configSnapshot, snapshot);
    assert.equal((await hr.patch(`${URL}/${p.id}/entries/${entries[0].id}`).send({ basicMinor: 1 })).status, 409);
    assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status, 409);
    await assert.rejects(query('UPDATE payroll_entries SET basic_minor=basic_minor WHERE id=$1', [entries[0].id]), /locked/);
    await assert.rejects(query('DELETE FROM payroll_periods WHERE id=$1', [p.id]), /deleted/);
    await assert.rejects(query("UPDATE payroll_periods SET config_snapshot='{}' WHERE id=$1", [p.id]), /locked/);
    assert.equal(await audits('payroll.period.approve'), 1);
  } finally { await query('UPDATE payroll_settings SET employee_pension_rate=5'); }
});
test('approval: stale settings require explicit recalculation and invalid brackets block approval', { skip }, async () => {
  const hr = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  await query('UPDATE income_tax_brackets SET rate=20');
  assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).body.error.code, 'stale_payroll');
  assert.equal((await hr.get(`${URL}/${p.id}`)).body.status, 'draft');
  for (const e of (await hr.get(`${URL}/${p.id}/entries`)).body.items) assert.equal((await hr.patch(`${URL}/${p.id}/entries/${e.id}`).send({ basicMinor: e.basicMinor })).status, 200);
  assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status, 200);
});
test('approval: employee/locked access, no entries and concurrent approvals', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  assert.equal((await emp.post(`${URL}/${p.id}/approve`).send({})).status, 403);
  const hr2 = await signIn(app, HR);
  const results = await Promise.all([hr.post(`${URL}/${p.id}/approve`).send({}), hr2.post(`${URL}/${p.id}/approve`).send({})]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200,409]);
  assert.equal(await audits('payroll.period.approve'), 1);
  await hr.post('/api/qr/lock').send({});
  assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status, 423);
  const empty = (await query("INSERT INTO payroll_periods (period_month) VALUES ('2026-11-01') RETURNING id")).rows[0].id;
  assert.equal((await hr2.post(`${URL}/${empty}/approve`).send({})).status, 422);
});
test('approval: audit failure rolls back status, approver and snapshot', { skip }, async () => {
  const hr = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  await query("CREATE FUNCTION test_fail_approval_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='payroll.period.approve' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
  await query('CREATE TRIGGER test_fail_approval_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_approval_audit()');
  try {
    assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status, 500);
    const period = (await hr.get(`${URL}/${p.id}`)).body;
    assert.equal(period.status, 'draft'); assert.equal(period.approvedAt, null);
    assert.equal(period.approvedByUserId, null); assert.equal(period.configSnapshot, null);
    assert.equal(await audits('payroll.period.approve'), 0);
  } finally {
    await query('DROP TRIGGER test_fail_approval_audit ON audit_logs');
    await query('DROP FUNCTION test_fail_approval_audit()');
  }
});

test('payment: approved payroll records date/actor and preserves entries and snapshot', { skip }, async () => {
  const hr = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  const path = `${URL}/${p.id}`;
  assert.equal((await hr.post(`${path}/pay`).send({ paidOn: '2026-10-31' })).status, 409);
  assert.equal((await hr.post(`${path}/approve`).send({})).status, 200);
  const before = (await hr.get(path)).body;
  const entries = (await hr.get(`${path}/entries`)).body;
  const actor = Number((await query("SELECT id FROM users WHERE role='hr'")).rows[0].id);
  // Later configuration edits must not block recording payment or recalculate approved amounts.
  await query('DELETE FROM income_tax_brackets');
  const paid = await hr.post(`${path}/pay`).send({ paidOn: '2026-10-31', paidByUserId: 9999 });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.deepEqual(paid.body, { id: p.id, month: '2026-10', status: 'paid', paidOn: '2026-10-31', paidByUserId: actor });
  const after = (await hr.get(path)).body;
  assert.equal(after.paidOn, '2026-10-31'); assert.equal(after.paidByUserId, actor);
  assert.equal(after.approvedAt, before.approvedAt);
  assert.deepEqual(after.configSnapshot, before.configSnapshot);
  assert.deepEqual((await hr.get(`${path}/entries`)).body, entries);
  assert.equal((await hr.post(`${path}/pay`).send({ paidOn: '2026-11-01' })).status, 409);
  assert.equal(await audits('payroll.period.pay'), 1);
  assert.equal((await hr.patch(`${path}/entries/${entries.items[0].id}`).send({ basicMinor: 1 })).status, 409);
});
test('payment: role/lock/CSRF, invalid dates and absent periods cannot change state', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  const path = `${URL}/${p.id}/pay`;
  assert.equal((await hr.post(`${URL}/${p.id}/approve`).send({})).status, 200);
  const request = (await import('supertest')).default;
  assert.equal((await request(app).post(path).send({ paidOn: '2026-10-31' })).status, 401);
  assert.equal((await emp.post(path).send({ paidOn: '2026-10-31' })).status, 403);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(HR);
  assert.equal((await agent.post(path).send({ paidOn: '2026-10-31' })).status, 403);
  for (const body of [{}, { paidOn: '2026-02-29' }, { paidOn: '2026-13-01' }, { paidOn: null }]) assert.equal((await hr.post(path).send(body)).status, 400);
  assert.equal((await hr.post(`${URL}/999999/pay`).send({ paidOn: '2026-10-31' })).status, 404);
  await hr.post('/api/qr/lock').send({});
  assert.equal((await hr.post(path).send({ paidOn: '2026-10-31' })).status, 423);
  assert.equal(await audits('payroll.period.pay'), 0);
});
test('payment: concurrent recording succeeds once with one audit', { skip }, async () => {
  const hr = await signIn(app, HR), hr2 = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  await hr.post(`${URL}/${p.id}/approve`).send({});
  const results = await Promise.all([hr.post(`${URL}/${p.id}/pay`).send({ paidOn: '2026-10-31' }), hr2.post(`${URL}/${p.id}/pay`).send({ paidOn: '2026-11-01' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200,409]);
  assert.equal(await audits('payroll.period.pay'), 1);
  const winner = results.find((r) => r.status === 200).body;
  assert.equal((await hr.get(`${URL}/${p.id}`)).body.paidOn, winner.paidOn);
});
test('payment: audit failure rolls status and payment metadata back to approved', { skip }, async () => {
  const hr = await signIn(app, HR);
  const p = (await hr.post(URL).send({ month: '2026-10' })).body;
  await hr.post(`${URL}/${p.id}/approve`).send({});
  const before = (await hr.get(`${URL}/${p.id}`)).body;
  await query("CREATE FUNCTION test_fail_payment_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='payroll.period.pay' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
  await query('CREATE TRIGGER test_fail_payment_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_payment_audit()');
  try {
    assert.equal((await hr.post(`${URL}/${p.id}/pay`).send({ paidOn: '2026-10-31' })).status, 500);
    assert.deepEqual((await hr.get(`${URL}/${p.id}`)).body, before);
    assert.equal(await audits('payroll.period.pay'), 0);
  } finally {
    await query('DROP TRIGGER test_fail_payment_audit ON audit_logs');
    await query('DROP FUNCTION test_fail_payment_audit()');
  }
});

test('attendance policy: HR-only switches persist and audit only changed values', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  const path = '/api/payroll-settings/attendance-deductions';
  assert.deepEqual((await hr.get(path)).body, { absenceDeductionEnabled: false, unpaidLeaveDeductionEnabled: false });
  assert.equal((await emp.get(path)).status, 403);
  assert.equal((await emp.patch(path).send({ absenceDeductionEnabled: true })).status, 403);
  assert.equal((await hr.patch(path).send({ absenceDeductionEnabled: 'true' })).status, 400);
  assert.equal((await hr.patch(path).send({})).status, 400);
  const saved = await hr.patch(path).send({ absenceDeductionEnabled: true });
  assert.deepEqual(saved.body, { absenceDeductionEnabled: true, unpaidLeaveDeductionEnabled: false });
  await hr.patch(path).send({ absenceDeductionEnabled: true });
  assert.equal(await audits('payroll.attendance_policy.update'), 1);
  assert.equal((await hr.get(path)).body.absenceDeductionEnabled, true);
});
test('attendance deductions: holidays, pre-employment, paid leave, worked days excluded; recompute once', { skip }, async () => {
  const hr = await signIn(app, HR);
  await hr.patch('/api/payroll-settings/attendance-deductions').send({ absenceDeductionEnabled: true, unpaidLeaveDeductionEnabled: true });
  await query('UPDATE salary_profiles SET basic_minor=210000, allowance_minor=0');
  // January 2026: 22 weekdays less one holiday = 21; employees start Jan 5 so Jan 1–2 do not count as absence.
  await query("INSERT INTO holidays (holiday_date, name) VALUES ('2026-01-06','Holiday')");
  await query(`INSERT INTO attendance_records (employee_id,work_date,status,check_in_at)
    SELECT e.id,g.d::date,'present',g.d::timestamptz + interval '9 hours' FROM employees e
    CROSS JOIN generate_series('2026-01-05'::date,'2026-01-31'::date,interval '1 day') g(d)
    WHERE EXTRACT(ISODOW FROM g.d)<6 AND g.d::date NOT IN ('2026-01-06','2026-01-07','2026-01-08','2026-01-09')`);
  for (const [code,date] of [['annual','2026-01-08'],['unpaid','2026-01-09']]) await query(`INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,reason,status,decided_at)
    SELECT $1,id,$2,$2,1,'Test','approved',now() FROM leave_types WHERE code=$3`, [empId,date,code]);
  const p = (await hr.post(URL).send({ month: '2026-01' })).body;
  const path = `${URL}/${p.id}`;
  const first = (await hr.get(`${path}/entries`)).body.items.find((e) => e.employeeId === empId);
  assert.equal(first.otherDeductionsMinor, 20000); // Jan 7 absent + Jan 9 unpaid, no overlap
  for (let n=0; n<2; n++) {
    const edit = await hr.patch(`${path}/entries/${first.id}`).send({ basicMinor: 210000 });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.otherDeductionsMinor, 20000);
  }
  const items = (await query("SELECT kind,amount_minor FROM payroll_entry_items WHERE entry_id=$1 AND kind IN ('absence','unpaid_leave') ORDER BY kind", [first.id])).rows;
  assert.deepEqual(items.map((i) => [i.kind,Number(i.amount_minor)]), [['absence',10000],['unpaid_leave',10000]]);
  // A late HR correction invalidates approval until this entry is explicitly recalculated.
  await query("INSERT INTO attendance_records (employee_id,work_date,status,check_in_at) VALUES ($1,'2026-01-07','present','2026-01-07T09:00:00Z')", [empId]);
  assert.equal((await hr.post(`${path}/approve`).send({})).body.error.code, 'stale_payroll');
  assert.equal((await hr.patch(`${path}/entries/${first.id}`).send({ basicMinor: 210000 })).body.otherDeductionsMinor, 10000);
  assert.equal((await hr.post(`${path}/approve`).send({})).status, 200);
});
test('attendance deductions: future missing scans are not absence and disabling removes draft deductions', { skip }, async () => {
  const hr = await signIn(app, HR);
  await hr.patch('/api/payroll-settings/attendance-deductions').send({ absenceDeductionEnabled: true });
  const year = new Date().getUTCFullYear() + 1;
  const future = (await hr.post(URL).send({ month: `${year}-01` })).body;
  assert.ok((await hr.get(`${URL}/${future.id}/entries`)).body.items.every((e) => e.otherDeductionsMinor === 0));
  const past = (await hr.post(URL).send({ month: '2026-01' })).body;
  const entry = (await hr.get(`${URL}/${past.id}/entries`)).body.items[0];
  assert.ok(entry.otherDeductionsMinor > 0);
  await hr.patch('/api/payroll-settings/attendance-deductions').send({ absenceDeductionEnabled: false });
  const res = await hr.patch(`${URL}/${past.id}/entries/${entry.id}`).send({ basicMinor: entry.basicMinor });
  assert.equal(res.body.otherDeductionsMinor, 0);
});

test('entry detail: stored breakdown matches totals and remains stable after approval', { skip }, async () => {
  const hr = await signIn(app, HR), emp = await signIn(app, EMP);
  await query(`INSERT INTO deduction_items (employee_id,kind,name,amount_minor) VALUES ($1,'loan','Original loan',5000)`, [empId]);
  const p = (await hr.post(URL).send({ month:'2026-10' })).body;
  const e = (await hr.get(`${URL}/${p.id}/entries`)).body.items.find((r)=>r.employeeId===empId);
  const path=`${URL}/${p.id}/entries/${e.id}`;
  const detail=await hr.get(path);
  assert.equal(detail.status,200);
  assert.equal(detail.headers['cache-control'],'no-store');
  assert.equal(detail.body.items.reduce((s,i)=>s+i.amountMinor,0),e.otherDeductionsMinor);
  assert.equal(detail.body.entry.employerCostMinor,e.grossMinor+e.employerPensionMinor);
  assert.equal((await emp.get(path)).status,403);
  assert.equal((await hr.get(`${URL}/99999/entries/${e.id}`)).status,404);
  await hr.post(`${URL}/${p.id}/approve`).send({});
  const saved=(await hr.get(path)).body;
  await query('UPDATE salary_profiles SET basic_minor=999');
  await query('DELETE FROM income_tax_brackets');
  assert.deepEqual((await hr.get(path)).body,saved);
  await hr.post('/api/qr/lock').send({});
  assert.equal((await hr.get(path)).status,423);
});

test('period list: exact-month filtering distinguishes missing months and validates input', { skip }, async () => {
  const hr=await signIn(app,HR);
  await hr.post(URL).send({month:'2026-09'});
  await hr.post(URL).send({month:'2026-10'});
  const result=await hr.get(`${URL}?month=2026-09&pageSize=1`);
  assert.equal(result.status,200);
  assert.equal(result.body.total,1);
  assert.equal(result.body.items[0].month,'2026-09');
  assert.deepEqual((await hr.get(`${URL}?month=2026-11`)).body.items,[]);
  assert.equal((await hr.get(`${URL}?month=2026-11`)).body.total,0);
  for(const month of ['2026-13','2026-1','2026-01-01']) assert.equal((await hr.get(`${URL}?month=${month}`)).status,400);
});

test('CSV export: full sheet, headers, exact amounts and unchanged approved history', {skip},async()=>{
 const hr=await signIn(app,HR);
 const p=(await hr.post(URL).send({month:'2026-10'})).body;
 const entries=(await hr.get(`${URL}/${p.id}/entries?pageSize=1`)).body;
 assert.equal(entries.items.length,1);assert.equal(entries.total,2);
 const path=`${URL}/${p.id}/export.csv`;
 const exported=await hr.get(path);
 assert.equal(exported.status,200);assert.match(exported.headers['content-type'],/^text\/csv/);
 assert.equal(exported.headers['cache-control'],'no-store');
 assert.equal(exported.headers['content-disposition'],'attachment; filename="payroll-2026-10.csv"');
 assert.equal(exported.text.replace(/^\uFEFF/,'').trim().split('\r\n').length,3);
 assert.ok(exported.text.includes('2500.00,100.00,225.00,0.00,125.00,0.00,2250.00'));
 await hr.post(`${URL}/${p.id}/approve`).send({});
 await query('DELETE FROM income_tax_brackets');await query('UPDATE salary_profiles SET basic_minor=999');
 assert.equal((await hr.get(path)).text,exported.text);
});
test('CSV export: missing period, employee isolation and locked sessions', {skip},async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP);
 assert.equal((await hr.get(`${URL}/9999/export.csv`)).status,404);
 assert.equal((await emp.get(`${URL}/1/export.csv`)).status,403);
 await hr.post('/api/qr/lock').send({});
 assert.equal((await hr.get(`${URL}/1/export.csv`)).status,423);
});

test('payslips: draft hidden, released own only, guessed IDs return 404, no snapshot leakage', {skip},async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP);
 const request=(await import('supertest')).default;
 const p=(await hr.post(URL).send({month:'2026-10'})).body;
 const entries=(await hr.get(`${URL}/${p.id}/entries`)).body.items;
 const own=entries.find(e=>e.employeeId===empId),other=entries.find(e=>e.employeeId===otherId);
 assert.equal((await request(app).get('/api/payslips')).status,401);
 assert.equal((await hr.get('/api/payslips')).status,403);
 assert.equal((await emp.get('/api/payslips')).body.total,0);
 assert.equal((await emp.get(`/api/payslips/${own.id}`)).status,404);
 await hr.post(`${URL}/${p.id}/approve`).send({});
 const list=await emp.get(`/api/payslips?employeeId=${otherId}&userId=999`);
 assert.equal(list.status,200);assert.equal(list.headers['cache-control'],'no-store');
 assert.deepEqual(list.body.items.map(e=>e.id),[own.id]);
 assert.equal((await emp.get(`/api/payslips/${other.id}`)).status,404);
 assert.equal((await emp.get('/api/payslips/999999')).status,404);
 const slip=(await emp.get(`/api/payslips/${own.id}`)).body;
 assert.equal(slip.entry.employeeId,empId);assert.equal(slip.entry.netMinor,own.netMinor);
 assert.ok(!JSON.stringify(slip).includes(other.employeeName));
 assert.ok(!('configSnapshot' in slip));assert.ok(!('entries' in slip.period));
 await query('UPDATE salary_profiles SET basic_minor=999');await query('DELETE FROM income_tax_brackets');
 assert.deepEqual((await emp.get(`/api/payslips/${own.id}`)).body,slip);
 await hr.post(`${URL}/${p.id}/pay`).send({paidOn:'2026-10-31'});
 const paid=(await emp.get(`/api/payslips/${own.id}`)).body;
 assert.equal(paid.period.status,'paid');assert.equal(paid.paidOn,'2026-10-31');assert.deepEqual(paid.entry,slip.entry);
});

test('dashboard: HR only, no-store and locked-device protection', {skip},async()=>{
 const hr=await signIn(app,HR),emp=await signIn(app,EMP);
 const request=(await import('supertest')).default;
 assert.equal((await request(app).get('/api/dashboard')).status,401);
 assert.equal((await emp.get('/api/dashboard')).status,403);
 const r=await hr.get('/api/dashboard');assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');
 assert.ok(r.body.recentAttendance.length<=8);assert.ok(r.body.pendingLeave.length<=6);
 await hr.post('/api/qr/lock').send({});assert.equal((await hr.get('/api/dashboard')).status,423);
});
test('dashboard: company-day attendance, approved leave, pending count and payroll net totals', {skip},async()=>{
 const {loadDashboard}=await import('../src/services/dashboard.js');
 const hr=await signIn(app,HR);
 await hr.post(URL).send({month:'2026-01'});
 await query("INSERT INTO attendance_records (employee_id,work_date,status,check_in_at,late_minutes) VALUES ($1,'2026-01-05','late','2026-01-05T06:10:00Z',10)",[empId]);
 await query(`INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,reason,status,decided_at)
  SELECT $1,id,'2026-01-05','2026-01-05',1,'Test','approved',now() FROM leave_types WHERE code='unpaid'`,[otherId]);
 await query(`INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,reason)
  SELECT $1,id,'2026-01-06','2026-01-06',1,'Pending' FROM leave_types WHERE code='annual'`,[empId]);
 const read=now=>withTransaction(db=>loadDashboard(db,{now}));
 const d=await read('2026-01-05T18:00:00Z');
 assert.deepEqual(d.stats,{totalEmployees:2,presentToday:1,lateToday:1,absentToday:0,onLeaveToday:1,pendingLeave:1});
 assert.equal(d.payroll.month,'2026-01');assert.equal(d.payroll.totalMinor,320000);assert.equal(d.pendingLeave.length,1);
 await query("DELETE FROM leave_requests WHERE status='approved'");
 assert.equal((await read('2026-01-05T18:00:00Z')).stats.absentToday,1);
 assert.equal((await read('2026-01-05T05:00:00Z')).stats.absentToday,0);
 await query("INSERT INTO holidays (holiday_date,name) VALUES ('2026-01-05','Off')");
 assert.equal((await read('2026-01-05T18:00:00Z')).stats.absentToday,0);
 assert.equal((await query('SELECT count(*)::int n FROM attendance_records')).rows[0].n,1);
});
