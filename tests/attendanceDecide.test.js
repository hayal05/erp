// Task 2.13 against a real database: the decision from stored rows, and the FOR UPDATE row lock. Needs Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbSkip as skip, TRUNCATE_ALL } from './helpers.js';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { decideAction, ACTION } = await import('../src/services/attendance.js');

const DAY = '2026-10-19';
let emp;

before(async () => {
  if (skip) return;
  await migrate({ log: () => {} });
  await query(TRUNCATE_ALL);
  const { rows: [shift] } = await query(`INSERT INTO shifts (name, start_time, end_time) VALUES ('Day','09:00','17:00') RETURNING id`);
  const { rows: [u] } = await query(`INSERT INTO users (email, full_name, password_hash, role) VALUES ('e@x.test','E','x','employee') RETURNING id`);
  ({ rows: [emp] } = await query(`INSERT INTO employees (employee_code, user_id, start_date, shift_id) VALUES ('E-1',$1,'2026-01-05',$2) RETURNING id`, [u.id, shift.id]));
});
after(async () => { if (!skip) await query(TRUNCATE_ALL); await pool.end(); });

const clear = () => query('DELETE FROM attendance_records');
const put = (cols) => query(
  `INSERT INTO attendance_records (employee_id, work_date, check_in_at, check_out_at, status) VALUES ($1,$2,$3,$4,$5)`,
  [emp.id, DAY, cols.in ?? null, cols.out ?? null, cols.status]);

test('no row -> check in; in only -> check out; in and out -> second check-in refused', { skip }, async () => {
  await clear();
  assert.equal((await decideAction({ query }, emp.id, DAY)).action, ACTION.CHECK_IN);
  await put({ in: '2026-10-19T06:05:00Z', status: 'present' });
  assert.equal((await decideAction({ query }, emp.id, DAY)).action, ACTION.CHECK_OUT);
  await query(`UPDATE attendance_records SET check_out_at = '2026-10-19T14:00:00Z'`);
  await assert.rejects(decideAction({ query }, emp.id, DAY), (e) => e.status === 409 && e.code === 'already_checked_out');
});

test('another date or another employee does not count', { skip }, async () => {
  await clear();
  await put({ in: '2026-10-19T06:05:00Z', out: '2026-10-19T14:00:00Z', status: 'present' });
  assert.equal((await decideAction({ query }, emp.id, '2026-10-20')).action, ACTION.CHECK_IN);
  assert.equal((await decideAction({ query }, emp.id + 999, DAY)).action, ACTION.CHECK_IN);
});

test('absent row -> check in; on_leave row -> refused', { skip }, async () => {
  await clear();
  await put({ status: 'absent' });
  assert.equal((await decideAction({ query }, emp.id, DAY)).action, ACTION.CHECK_IN);
  await query(`UPDATE attendance_records SET status = 'on_leave'`);
  await assert.rejects(decideAction({ query }, emp.id, DAY), (e) => e.code === 'on_leave');
});

test('lock: a second transaction waits for the first to finish, then sees its result', { skip }, async () => {
  await clear();
  await put({ in: '2026-10-19T06:05:00Z', status: 'present' });
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query('BEGIN');
    assert.equal((await decideAction(a, emp.id, DAY, { lock: true })).action, ACTION.CHECK_OUT);
    await b.query('BEGIN');
    let settled = false;
    const second = decideAction(b, emp.id, DAY, { lock: true }).then((r) => { settled = true; return r; }, (e) => { settled = true; throw e; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(settled, false, 'second scan must wait while the first holds the row');
    await a.query(`UPDATE attendance_records SET check_out_at = '2026-10-19T14:00:00Z'`);
    await a.query('COMMIT');
    await assert.rejects(second, (e) => e.code === 'already_checked_out'); // sees the committed check-out, not a stale row
    await b.query('ROLLBACK');
  } finally { a.release(); b.release(); }
});
