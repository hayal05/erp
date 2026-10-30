import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');

const reset = () => query(TRUNCATE_ALL);
const rejects = (sql, params, re) => assert.rejects(query(sql, params), re);

before(async () => { if (!skip) { await migrate({ log: () => {} }); await reset(); } });
after(async () => { if (!skip) await reset(); await pool.end(); });

const addUser = (email, role = 'employee') =>
  query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, 'Test User', 'x', $2) RETURNING id`, [email, role]);
const addShift = (name = 'S1') =>
  query(`INSERT INTO shifts (name, start_time, end_time) VALUES ($1, '09:00', '17:00') RETURNING id`, [name]);

test('core tables exist', { skip }, async () => {
  const { rows } = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  const names = rows.map((r) => r.table_name);
  for (const t of ['users', 'sessions', 'departments', 'shifts', 'employees', 'audit_logs', 'attendance_tokens', 'attendance_records', 'leave_types', 'leave_balances', 'leave_requests', 'holidays']) assert.ok(names.includes(t), t);
});

test('only hr and employee roles exist (no kiosk role)', { skip }, async () => {
  await addUser('hr@x.com', 'hr');
  await rejects(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('k@x.com','K','x','kiosk')`, [], /users_role_check/);
});

test('email is unique case-insensitively', { skip }, async () => {
  await addUser('dup@x.com');
  await rejects(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('DUP@x.com','D','x','employee')`, [], /users_username_key/);
});

test('shifts must be same-day with valid work days', { skip }, async () => {
  await rejects(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Night','22:00','06:00')`, [], /shifts_same_day/);
  await rejects(`INSERT INTO shifts (name, start_time, end_time, work_days) VALUES ('Bad','09:00','17:00','{0,8}')`, [], /shifts_work_days_valid/);
});

test('session lock flag and timestamp must agree', { skip }, async () => {
  const { rows: [u] } = await addUser('s@x.com');
  const ins = (locked, at) => query(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at, locked, locked_at) VALUES (md5(random()::text), $1, 'c', now() + interval '1 hour', $2, $3)`,
    [u.id, locked, at]);
  await ins(false, null);
  await ins(true, new Date());
  await assert.rejects(ins(true, null), /sessions_lock_consistent/);
  await assert.rejects(ins(false, new Date()), /sessions_lock_consistent/);
});

test('deleting a user removes their sessions', { skip }, async () => {
  const { rows: [u] } = await addUser('c@x.com');
  await query(`INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ('abc', $1, 'c', now() + interval '1 hour')`, [u.id]);
  await query('DELETE FROM users WHERE id = $1', [u.id]);
  assert.equal((await query(`SELECT 1 FROM sessions WHERE id = 'abc'`)).rowCount, 0);
});

test('employees: unique code and user, user cannot be hard-deleted', { skip }, async () => {
  const { rows: [shift] } = await addShift();
  const { rows: [u1] } = await addUser('e1@x.com');
  const { rows: [u2] } = await addUser('e2@x.com');
  const ins = (code, uid) => query(
    `INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1, $2, '2026-01-05', $3)`, [code, uid, shift.id]);
  await ins('EMP-001', u1.id);
  await assert.rejects(ins('emp-001', u2.id), /employees_code_key/);
  await assert.rejects(ins('EMP-002', u1.id), /employees_user_id_key/);
  await assert.rejects(query('DELETE FROM users WHERE id = $1', [u1.id]), /foreign key/);
});

test('audit_logs is append-only', { skip }, async () => {
  await query(`INSERT INTO audit_logs (action, entity_type, entity_id, reason) VALUES ('employee.update','employee','1','test')`);
  await assert.rejects(query(`UPDATE audit_logs SET reason = 'edited'`), /append-only/);
  await assert.rejects(query(`DELETE FROM audit_logs`), /append-only/);
  assert.equal((await query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n, 1);
});

// ---- migration 002: attendance
const addEmployee = async (email, code) => {
  const { rows: [u] } = await addUser(email);
  const { rows: [shift] } = await addShift(`S-${code}`);
  const { rows: [e] } = await query(
    `INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1, $2, '2026-01-05', $3) RETURNING id`,
    [code, u.id, shift.id]);
  return e.id;
};
const addRecord = (empId, date, status = 'present', extra = {}) => query(
  `INSERT INTO attendance_records (employee_id, work_date, check_in_at, check_out_at, status, late_minutes)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [empId, date, extra.in === undefined ? new Date('2026-10-19T06:00:00Z') : extra.in, extra.out ?? null, status, extra.late ?? 0]);

test('attendance: one record per employee per work date', { skip }, async () => {
  const emp = await addEmployee('a1@x.com', 'A-001');
  await addRecord(emp, '2026-10-19');
  await rejects(`INSERT INTO attendance_records (employee_id, work_date, check_in_at, status) VALUES ($1, '2026-10-19', now(), 'present')`, [emp], /attendance_one_per_day/);
  await addRecord(emp, '2026-10-20'); // a different day is fine
});

test('attendance: check-out must follow check-in; statuses and late minutes are consistent', { skip }, async () => {
  const emp = await addEmployee('a2@x.com', 'A-002');
  await assert.rejects(addRecord(emp, '2026-10-19', 'present', { out: new Date('2026-10-19T05:00:00Z') }), /attendance_out_after_in/);
  await assert.rejects(addRecord(emp, '2026-10-19', 'present', { in: null, out: new Date() }), /attendance_out_needs_in/);
  await assert.rejects(addRecord(emp, '2026-10-19', 'late', { in: null }), /attendance_worked_needs_in/);
  await assert.rejects(addRecord(emp, '2026-10-19', 'present', { late: 5 }), /attendance_late_only_when_late/);
  await assert.rejects(addRecord(emp, '2026-10-19', 'holiday'), /attendance_records_status_check/);
  await addRecord(emp, '2026-10-19', 'late', { late: 12 });
  await addRecord(emp, '2026-10-20', 'absent', { in: null }); // absence needs no check-in
});

test('attendance: a correction needs a non-blank reason', { skip }, async () => {
  const emp = await addEmployee('a3@x.com', 'A-003');
  await addRecord(emp, '2026-10-19');
  await rejects(`UPDATE attendance_records SET corrected_at = now(), correction_reason = '  ' WHERE employee_id = $1`, [emp], /attendance_correction_complete/);
  await query(`UPDATE attendance_records SET corrected_at = now(), correction_reason = 'forgot to check out' WHERE employee_id = $1`, [emp]);
});

test('attendance: employees with attendance cannot be hard-deleted', { skip }, async () => {
  const emp = await addEmployee('a4@x.com', 'A-004');
  await addRecord(emp, '2026-10-19');
  await rejects('DELETE FROM employees WHERE id = $1', [emp], /foreign key/);
});

test('attendance_tokens: hash is unique, use is consistent, tokens die with their session', { skip }, async () => {
  const emp = await addEmployee('a5@x.com', 'A-005');
  const { rows: [hr] } = await addUser('hr2@x.com', 'hr');
  await query(`INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ('tok-s', $1, 'c', now() + interval '1 hour')`, [hr.id]);
  const ins = (hash) => query(
    `INSERT INTO attendance_tokens (token_hash, issued_by_session_id, issued_by_user_id, expires_at) VALUES ($1, 'tok-s', $2, now() + interval '45 seconds')`,
    [hash, hr.id]);
  await ins('h1');
  await assert.rejects(ins('h1'), /attendance_tokens_hash_key/);
  await rejects(`UPDATE attendance_tokens SET used_at = now()`, [], /attendance_tokens_use_consistent/);
  await rejects(`UPDATE attendance_tokens SET used_by_employee_id = $1`, [emp], /attendance_tokens_use_consistent/);
  await query(`UPDATE attendance_tokens SET used_at = now(), used_by_employee_id = $1`, [emp]);
  await rejects(`INSERT INTO attendance_tokens (token_hash, issued_by_session_id, issued_by_user_id, created_at, expires_at)
                 VALUES ('h2', 'tok-s', $1, now(), now() - interval '1 second')`, [hr.id], /attendance_tokens_expiry_after_creation/);
  await query(`DELETE FROM sessions WHERE id = 'tok-s'`);
  assert.equal((await query('SELECT count(*)::int AS n FROM attendance_tokens')).rows[0].n, 0);
});

// ---- 003 leave
const leaveType = async (code) => Number((await query('SELECT id FROM leave_types WHERE code = $1', [code])).rows[0].id);
const addRequest = (emp, type, start, end, { days = 1, status = 'pending', extra = '' } = {}) => query(
  `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status${extra ? ', decided_at, decision_remarks' : ''})
   VALUES ($1, $2, $3, $4, $5, 'family', $6${extra ? ", now(), 'ok'" : ''}) RETURNING id`, [emp, type, start, end, days, status]);

test('leave: the four spec types are seeded; unpaid has no balance', { skip }, async () => {
  const { rows } = await query('SELECT code, is_paid, has_balance, default_days FROM leave_types ORDER BY code');
  assert.deepEqual(rows.map((r) => r.code), ['annual', 'personal', 'sick', 'unpaid']);
  const unpaid = rows.find((r) => r.code === 'unpaid');
  assert.deepEqual([unpaid.is_paid, unpaid.has_balance, unpaid.default_days], [false, false, 0]);
  await rejects(`INSERT INTO leave_types (code, name) VALUES ('annual', 'Dup')`, [], /leave_types_code_key/);
  await rejects(`INSERT INTO leave_types (code, name, has_balance, default_days) VALUES ('x', 'X', false, 3)`, [], /leave_types_check/);
});

test('leave_balances: one row per employee/type/year, never negative in total', { skip }, async () => {
  const emp = await addEmployee('l1@x.com', 'L-001');
  const annual = await leaveType('annual');
  const ins = (year, entitled, adjusted = 0) => query(
    `INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days, adjusted_days) VALUES ($1, $2, $3, $4, $5)`, [emp, annual, year, entitled, adjusted]);
  await ins(2026, 16);
  await rejects(`INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days) VALUES ($1, $2, 2026, 5)`, [emp, annual], /leave_balances_unique/);
  await ins(2027, 10, -10); // exactly zero is fine
  await rejects(`UPDATE leave_balances SET adjusted_days = -11 WHERE year = 2027`, [], /leave_balances_not_negative/);
  await rejects(`INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days) VALUES ($1, $2, 2028, -1)`, [emp, annual], /entitled_days_check/);
});

test('leave_requests: dates ordered, one calendar year, days >= 1, reason required', { skip }, async () => {
  const emp = await addEmployee('l2@x.com', 'L-002');
  const annual = await leaveType('annual');
  await addRequest(emp, annual, '2026-10-20', '2026-10-22', { days: 3 });
  await rejects(`INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1, $2, '2026-10-22', '2026-10-20', 1, 'x')`, [emp, annual], /leave_requests_dates_ordered/);
  await rejects(`INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1, $2, '2026-12-30', '2027-01-02', 2, 'x')`, [emp, annual], /leave_requests_one_year/);
  await rejects(`INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1, $2, '2026-11-02', '2026-11-02', 0, 'x')`, [emp, annual], /leave_requests_days_check/);
  await rejects(`INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1, $2, '2026-11-02', '2026-11-02', 1, '  ')`, [emp, annual], /leave_requests_reason_check/);
});

test('leave_requests: decisions need a timestamp and a rejection needs remarks; status values are fixed', { skip }, async () => {
  const emp = await addEmployee('l3@x.com', 'L-003');
  const annual = await leaveType('annual');
  const { rows: [r] } = await addRequest(emp, annual, '2026-11-02', '2026-11-03', { days: 2 });
  await rejects(`UPDATE leave_requests SET status = 'approved' WHERE id = $1`, [r.id], /leave_requests_decision_consistent/);
  await rejects(`UPDATE leave_requests SET status = 'rejected', decided_at = now() WHERE id = $1`, [r.id], /leave_requests_decision_consistent/);
  await rejects(`UPDATE leave_requests SET status = 'rejected', decided_at = now(), decision_remarks = '  ' WHERE id = $1`, [r.id], /leave_requests_decision_consistent/);
  await query(`UPDATE leave_requests SET status = 'rejected', decided_at = now(), decision_remarks = 'Busy period' WHERE id = $1`, [r.id]);
  await rejects(`UPDATE leave_requests SET status = 'maybe' WHERE id = $1`, [r.id], /leave_requests_status_check/);
});

test('leave_requests: approved leave cannot overlap for one employee (exclusion constraint)', { skip }, async () => {
  const emp = await addEmployee('l4@x.com', 'L-004');
  const other = await addEmployee('l5@x.com', 'L-005');
  const annual = await leaveType('annual'), sick = await leaveType('sick');
  await addRequest(emp, annual, '2026-11-10', '2026-11-12', { days: 3, status: 'approved', extra: 'decided' });
  await rejects(`INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status, decided_at)
                 VALUES ($1, $2, '2026-11-12', '2026-11-13', 2, 'x', 'approved', now())`, [emp, sick], /leave_no_overlapping_approved/); // touching on one day counts
  await addRequest(emp, sick, '2026-11-13', '2026-11-13', { days: 1, status: 'approved', extra: 'decided' }); // next day is fine
  await addRequest(other, annual, '2026-11-10', '2026-11-12', { days: 3, status: 'approved', extra: 'decided' }); // other person is fine
  await addRequest(emp, annual, '2026-11-11', '2026-11-11', { days: 1 }); // pending requests may overlap: the API decides, only approval is exclusive
  await addRequest(emp, annual, '2026-11-11', '2026-11-11', { days: 1, status: 'rejected', extra: 'decided' });
});

test('leave: employees and leave types with requests cannot be hard-deleted; holidays are unique per date', { skip }, async () => {
  const emp = await addEmployee('l6@x.com', 'L-006');
  const annual = await leaveType('annual');
  await addRequest(emp, annual, '2026-11-16', '2026-11-16');
  await rejects('DELETE FROM employees WHERE id = $1', [emp], /foreign key/);
  await rejects('DELETE FROM leave_types WHERE id = $1', [annual], /foreign key/);
  await query(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-01-07', 'Christmas')`);
  await rejects(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-01-07', 'Again')`, [], /holidays_date_key/);
  await rejects(`INSERT INTO holidays (holiday_date, name) VALUES ('2026-01-08', ' ')`, [], /holidays_name_check/);
});

// ---- Migration 004 (task 4.1): payroll. Written without a database to run them against: run `npm test` first.
const mkEmployee = async (code) => {
  const { rows: [u] } = await addUser(`${code.toLowerCase()}@payroll.test`);
  const { rows: [s] } = await addShift(`S-${code}`);
  return Number((await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ($1,$2,'2026-01-05',$3) RETURNING id`, [code, u.id, s.id])).rows[0].id);
};
const addPeriod = async (month = '2026-10-01') => Number((await query(`INSERT INTO payroll_periods (period_month) VALUES ($1) RETURNING id`, [month])).rows[0].id);
const addEntry = (periodId, employeeId, over = {}) => {
  const e = { basic: 250000, allowance: 50000, tax: 22500, otherTax: 0, pension: 12500, employerPension: 25000, deductions: 10000, ...over };
  const gross = e.gross ?? e.basic + e.allowance;
  return query(
    `INSERT INTO payroll_entries (period_id, employee_id, employee_code, employee_name, basic_minor, allowance_minor, gross_minor, taxable_income_minor,
       income_tax_rate, income_tax_fixed_deduction_minor, income_tax_minor, other_tax_minor, pensionable_minor, employee_pension_rate, employee_pension_minor,
       employer_pension_rate, employer_pension_minor, other_deductions_minor, net_minor, employer_cost_minor)
     VALUES ($1,$2,'E','Name',$3,$4,$5,$3,15,15000,$6,$7,$3,5,$8,10,$9,$10,$11,$12) RETURNING id`,
    [periodId, employeeId, e.basic, e.allowance, e.gross ?? gross, e.tax, e.otherTax, e.pension, e.employerPension, e.deductions,
      e.net ?? gross - e.tax - e.otherTax - e.pension - e.deductions, e.employerCost ?? gross + e.employerPension]);
};
const approvePeriod = async (id) => {
  const { rows: [u] } = await query(`SELECT id FROM users LIMIT 1`);
  await query(`UPDATE payroll_periods SET status = 'approved', approved_at = now(), approved_by_user_id = $2, config_snapshot = '{"v":1}' WHERE id = $1`, [id, u.id]);
  return Number(u.id);
};

test('payroll_settings: one seeded row with the spec defaults; a second row is impossible; rates stay within 0-100', { skip }, async () => {
  const { rows } = await query('SELECT * FROM payroll_settings');
  assert.equal(rows.length, 1);
  assert.deepEqual([Number(rows[0].employee_pension_rate), Number(rows[0].company_pension_rate), rows[0].tax_base, rows[0].rounding_mode], [5, 10, 'basic', 'half_up']);
  await rejects('INSERT INTO payroll_settings (id) VALUES (false)', [], /check|violates/i);
  await rejects('UPDATE payroll_settings SET employee_pension_rate = 101', [], /check|violates/i);
  await rejects(`UPDATE payroll_settings SET tax_base = 'everything'`, [], /check|violates/i);
});

test('income_tax_brackets: bounds ordered, rate 0-100, overlapping brackets refused, one open-ended bracket at most', { skip }, async () => {
  await reset();
  const add = (from, to, rate = 15, ded = 0) => query('INSERT INTO income_tax_brackets (from_minor, to_minor, rate, fixed_deduction_minor) VALUES ($1,$2,$3,$4)', [from, to, rate, ded]);
  await add(0, 60000, 0);
  await add(60000, 165000, 10, 6000); // touching (exclusive upper bound) is fine
  await rejects('INSERT INTO income_tax_brackets (from_minor, to_minor, rate) VALUES (100000, 200000, 10)', [], /overlap|conflicting|exclusion/i);
  await add(165000, null, 20, 15000);
  await rejects('INSERT INTO income_tax_brackets (from_minor, to_minor, rate) VALUES (900000, NULL, 30)', [], /overlap|conflicting|exclusion/i);
  await rejects('INSERT INTO income_tax_brackets (from_minor, to_minor, rate) VALUES (5, 5, 10)', [], /check|violates/i);
  await rejects('INSERT INTO income_tax_brackets (from_minor, to_minor, rate) VALUES (-1, 5, 10)', [], /check|violates/i);
  await rejects('INSERT INTO income_tax_brackets (from_minor, to_minor, rate) VALUES (1000000, 2000000, 100.5)', [], /check|violates/i);
});

test('other_taxes and deduction_items: fixed bases/kinds, positive amounts, unique tax names, one-time items cannot be marked recurring and consumed', { skip }, async () => {
  await reset();
  const emp = await mkEmployee('P-1');
  await query(`INSERT INTO other_taxes (name, rate, base) VALUES ('Stamp', 2, 'gross')`);
  await rejects(`INSERT INTO other_taxes (name, rate, base) VALUES ('stamp', 1, 'basic')`, [], /unique|duplicate/i);
  await rejects(`INSERT INTO other_taxes (name, rate, base) VALUES ('X', 1, 'my_formula')`, [], /check|violates/i);
  const add = (kind, amount, recurring = false) => query('INSERT INTO deduction_items (employee_id, kind, name, amount_minor, recurring) VALUES ($1,$2,$3,$4,$5)', [emp, kind, 'Item', amount, recurring]);
  await add('advance', 50000);
  await rejects(`INSERT INTO deduction_items (employee_id, kind, name, amount_minor) VALUES ($1, 'bribe', 'x', 1)`, [emp], /check|violates/i);
  await rejects(`INSERT INTO deduction_items (employee_id, kind, name, amount_minor) VALUES ($1, 'loan', 'x', 0)`, [emp], /check|violates/i);
  const period = await addPeriod();
  await rejects('INSERT INTO deduction_items (employee_id, kind, name, amount_minor, recurring, applied_period_id) VALUES ($1,$2,$3,$4,true,$5)', [emp, 'loan', 'x', 1, period], /check|violates/i);
});

test('salary_profiles: one per employee, no negative money; payroll_periods: first of the month, one per month, status rules', { skip }, async () => {
  await reset();
  const emp = await mkEmployee('P-2');
  await query('INSERT INTO salary_profiles (employee_id, basic_minor, allowance_minor) VALUES ($1, 250000, 50000)', [emp]);
  await rejects('INSERT INTO salary_profiles (employee_id) VALUES ($1)', [emp], /unique|duplicate/i);
  const emp2 = await mkEmployee('P-3');
  await rejects('INSERT INTO salary_profiles (employee_id, basic_minor) VALUES ($1, -1)', [emp2], /check|violates/i);
  await addPeriod('2026-10-01');
  await rejects(`INSERT INTO payroll_periods (period_month) VALUES ('2026-10-01')`, [], /unique|duplicate/i);
  await rejects(`INSERT INTO payroll_periods (period_month) VALUES ('2026-11-15')`, [], /check|violates/i);
  await rejects(`INSERT INTO payroll_periods (period_month, status) VALUES ('2026-12-01', 'approved')`, [], /check|violates/i); // approved needs time, snapshot and approver
  await rejects('DELETE FROM employees WHERE id = $1', [emp], /foreign key|violates/i);
});

test('payroll_entries: the spec 17 formulas are enforced (gross, net, employer cost) and one entry per employee per period', { skip }, async () => {
  await reset();
  const emp = await mkEmployee('P-4'), period = await addPeriod();
  await addEntry(period, emp); // 300,000 gross - 22,500 - 12,500 - 10,000 = 255,000 net
  assert.equal(Number((await query('SELECT net_minor FROM payroll_entries')).rows[0].net_minor), 255000);
  const emp2 = await mkEmployee('P-5');
  await assert.rejects(addEntry(period, emp2, { net: 1 }), /payroll_entries_net/);
  await assert.rejects(addEntry(period, emp2, { gross: 1 }), /payroll_entries_gross/);
  await assert.rejects(addEntry(period, emp2, { employerCost: 1 }), /payroll_entries_employer_cost/);
  await assert.rejects(addEntry(period, emp), /unique|duplicate/i);
});

test('an approved payroll is immutable: no entry or item changes, no delete; approved -> paid is the only period change; draft stays editable', { skip }, async () => {
  await reset();
  const emp = await mkEmployee('P-6'), emp2 = await mkEmployee('P-7'), period = await addPeriod();
  const entryId = Number((await addEntry(period, emp)).rows[0].id);
  await query(`INSERT INTO payroll_entry_items (entry_id, kind, label, amount_minor) VALUES ($1, 'advance', 'Salary advance', 10000)`, [entryId]);
  await query('UPDATE payroll_entries SET basic_minor = basic_minor WHERE id = $1', [entryId]); // a draft is editable (engine recalculation)
  await assert.rejects(query(`INSERT INTO payroll_entry_items (entry_id, kind, label, amount_minor) VALUES ($1, 'other_tax', 'Stamp', 1)`, [entryId]), /check|violates/i); // tax item needs rate + base

  const userId = await approvePeriod(period);
  const locked = /locked/i;
  await assert.rejects(query('UPDATE payroll_entries SET other_tax_minor = 0 WHERE id = $1', [entryId]), locked);
  await assert.rejects(query('DELETE FROM payroll_entries WHERE id = $1', [entryId]), locked);
  await assert.rejects(addEntry(period, emp2), locked);
  await assert.rejects(query('UPDATE payroll_entry_items SET amount_minor = 1 WHERE entry_id = $1', [entryId]), locked);
  await assert.rejects(query('DELETE FROM payroll_entry_items WHERE entry_id = $1', [entryId]), locked);
  await assert.rejects(query(`INSERT INTO payroll_entry_items (entry_id, kind, label, amount_minor) VALUES ($1, 'loan', 'Late add', 5)`, [entryId]), locked);
  await assert.rejects(query('DELETE FROM payroll_periods WHERE id = $1', [period]), /cannot be deleted/i);
  await assert.rejects(query(`UPDATE payroll_periods SET config_snapshot = '{"v":2}' WHERE id = $1`, [period]), locked);
  await assert.rejects(query(`UPDATE payroll_periods SET status = 'draft', approved_at = NULL WHERE id = $1`, [period]), /locked|check/i);

  await query(`UPDATE payroll_periods SET status = 'paid', paid_on = '2026-10-31', paid_by_user_id = $2 WHERE id = $1`, [period, userId]);
  await assert.rejects(query(`UPDATE payroll_periods SET paid_on = '2026-11-01' WHERE id = $1`, [period]), locked);
  assert.equal(Number((await query('SELECT count(*) AS n FROM payroll_entries')).rows[0].n), 1);
});

test('a draft period can be deleted with its entries; one-time deductions it consumed become available again', { skip }, async () => {
  await reset();
  const emp = await mkEmployee('P-8'), period = await addPeriod();
  const entryId = Number((await addEntry(period, emp)).rows[0].id);
  await query(`INSERT INTO payroll_entry_items (entry_id, kind, label, amount_minor) VALUES ($1, 'advance', 'Advance', 10000)`, [entryId]);
  const item = Number((await query(`INSERT INTO deduction_items (employee_id, kind, name, amount_minor, applied_period_id) VALUES ($1,'advance','Advance',10000,$2) RETURNING id`, [emp, period])).rows[0].id);
  await query('DELETE FROM payroll_periods WHERE id = $1', [period]);
  assert.deepEqual([(await query('SELECT count(*)::int AS n FROM payroll_entries')).rows[0].n, (await query('SELECT count(*)::int AS n FROM payroll_entry_items')).rows[0].n], [0, 0]);
  assert.equal((await query('SELECT applied_period_id FROM deduction_items WHERE id = $1', [item])).rows[0].applied_period_id, null);
});

// ---- Migration 005 (task 6.1): positions and employees.position_id
const addDept = async (name) => Number((await query('INSERT INTO departments (name) VALUES ($1) RETURNING id', [name])).rows[0].id);
const addPosition = async (departmentId, name, over = {}) => {
  const p = { basic: 500000, allowance: 100000, ...over };
  return Number((await query(
    'INSERT INTO positions (department_id, name, basic_minor, allowance_minor) VALUES ($1, $2, $3, $4) RETURNING id',
    [departmentId, name, p.basic, p.allowance])).rows[0].id);
};

test('positions: defaults mirror salary_profiles (zero money, all flags true) and updated_at moves on change', { skip }, async () => {
  const d = await addDept('Defaults Dept');
  const { rows: [p] } = await query(`INSERT INTO positions (department_id, name) VALUES ($1, 'Cashier') RETURNING *`, [d]);
  assert.deepEqual([Number(p.basic_minor), Number(p.allowance_minor), p.allowance_taxable, p.allowance_pensionable, p.pension_applies], [0, 0, true, true, true]);
  await query(`SELECT pg_sleep(0.01)`);
  const { rows: [after] } = await query(`UPDATE positions SET basic_minor = 1 WHERE id = $1 RETURNING updated_at > created_at AS moved`, [p.id]);
  assert.equal(after.moved, true);
});

test('positions: name unique per department (case-insensitive), reusable across departments, never blank', { skip }, async () => {
  const [a, b] = [await addDept('Unique A'), await addDept('Unique B')];
  await addPosition(a, 'Manager');
  await rejects(`INSERT INTO positions (department_id, name) VALUES ($1, 'manager')`, [a], /positions_name_key/);
  await addPosition(b, 'Manager'); // another department may use the same name
  await rejects(`INSERT INTO positions (department_id, name) VALUES ($1, '   ')`, [a], /positions_name_check/);
});

test('positions: money uses the same limits as salary profiles', { skip }, async () => {
  const d = await addDept('Money Dept');
  await rejects(`INSERT INTO positions (department_id, name, basic_minor) VALUES ($1, 'Neg basic', -1)`, [d], /positions_basic_minor_check/);
  await rejects(`INSERT INTO positions (department_id, name, allowance_minor) VALUES ($1, 'Neg allowance', -1)`, [d], /positions_allowance_minor_check/);
  await rejects(`INSERT INTO positions (department_id, name, basic_minor) VALUES ($1, 'Too big', 10000000000000)`, [d], /positions_basic_minor_check/);
  await addPosition(d, 'Max', { basic: 9999999999999, allowance: 9999999999999 });
});

test('positions: a department that has positions cannot be deleted; an empty one can', { skip }, async () => {
  const [full, empty] = [await addDept('Has positions'), await addDept('No positions')];
  await addPosition(full, 'Clerk');
  await rejects('DELETE FROM departments WHERE id = $1', [full], /foreign key|restrict/i);
  await query('DELETE FROM departments WHERE id = $1', [empty]);
});

test('employees.position_id: optional, same-department only, and a position in use cannot be deleted', { skip }, async () => {
  const [sales, ops] = [await addDept('Sales 005'), await addDept('Ops 005')];
  const [seller, planner] = [await addPosition(sales, 'Seller'), await addPosition(ops, 'Planner')];
  const emp = await mkEmployee('POS-001');
  assert.equal((await query('SELECT position_id FROM employees WHERE id = $1', [emp])).rows[0].position_id, null); // existing behaviour

  const assign = (dept, pos) => query('UPDATE employees SET department_id = $2, position_id = $3 WHERE id = $1', [emp, dept, pos]);
  await assign(sales, seller); // own department: fine
  await rejects('UPDATE employees SET position_id = $2 WHERE id = $1', [emp, planner], /employees_position_department_fkey/); // other department
  await rejects('UPDATE employees SET department_id = $2 WHERE id = $1', [emp, ops], /employees_position_department_fkey/); // moving department with a stale position
  await assign(ops, null); // clearing the position while moving is the supported path
  await assign(ops, planner);
  await rejects('UPDATE employees SET department_id = NULL WHERE id = $1', [emp], /employees_position_needs_department|employees_position_department_fkey/);
  await rejects('DELETE FROM positions WHERE id = $1', [planner], /foreign key|restrict/i); // in use
  await assign(ops, null);
  await query('DELETE FROM positions WHERE id = $1', [planner]); // unused now
});

test('employees.position_id: a position with no department is refused', { skip }, async () => {
  const d = await addDept('Orphan check');
  const pos = await addPosition(d, 'Lead');
  const emp = await mkEmployee('POS-002');
  await rejects('UPDATE employees SET position_id = $2 WHERE id = $1', [emp, pos], /employees_position_needs_department/);
});

test('005 does not touch payroll: salary_profiles and payroll_entries keep their shape', { skip }, async () => {
  const { rows } = await query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('salary_profiles', 'payroll_entries') AND column_name LIKE '%position%'`);
  assert.deepEqual(rows, []);
});
