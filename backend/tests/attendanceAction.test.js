import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAction, decideAction, ACTION } from '../src/services/attendance.js';

const T = new Date('2026-10-19T06:00:00Z');
const err = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('did not throw'); };

test('no record -> check in', () => {
  assert.equal(nextAction(null), ACTION.CHECK_IN);
  assert.equal(nextAction(undefined), ACTION.CHECK_IN);
});

test('checked in, not out -> check out (also when marked incomplete)', () => {
  assert.equal(nextAction({ status: 'present', check_in_at: T, check_out_at: null }), ACTION.CHECK_OUT);
  assert.equal(nextAction({ status: 'late', check_in_at: T, check_out_at: null }), ACTION.CHECK_OUT);
  assert.equal(nextAction({ status: 'incomplete', check_in_at: T, check_out_at: null }), ACTION.CHECK_OUT);
});

test('a second check-in the same day is refused (409 already_checked_out)', () => {
  const e = err(() => nextAction({ status: 'present', check_in_at: T, check_out_at: new Date(T.getTime() + 3600e3) }));
  assert.deepEqual([e.status, e.code], [409, 'already_checked_out']);
});

test('a pre-created absent row without check-in -> check in', () => {
  assert.equal(nextAction({ status: 'absent', check_in_at: null, check_out_at: null }), ACTION.CHECK_IN);
});

test('an on_leave row without check-in is refused (409 on_leave)', () => {
  const e = err(() => nextAction({ status: 'on_leave', check_in_at: null, check_out_at: null }));
  assert.deepEqual([e.status, e.code], [409, 'on_leave']);
});

test('check-out is never returned without a check-in', () => {
  for (const status of ['present', 'late', 'absent', 'incomplete']) {
    assert.notEqual(nextAction({ status, check_in_at: null, check_out_at: null }), ACTION.CHECK_OUT);
  }
});

test('decideAction queries by employee and date, locks only when asked', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  assert.deepEqual(await decideAction(db, 7, '2026-10-19'), { action: ACTION.CHECK_IN, record: null });
  await decideAction(db, 7, '2026-10-19', { lock: true });
  assert.deepEqual(calls[0].params, [7, '2026-10-19']);
  assert.doesNotMatch(calls[0].sql, /FOR UPDATE/);
  assert.match(calls[1].sql, /FOR UPDATE/);
});

// ---- 2.14 applyScan, order of operations with a fake transaction (no database needed)
import { applyScan, statusAfterCheckOut } from '../src/services/attendance.js';
const PHOTO = 'natra/selfies/2026/' + 'a'.repeat(24);
const TOKEN = 'T'.repeat(43);

function fakeTx({ record = null, tokenRow = { id: 1, issued_by_session_id: 's1', used: false, expired: false, issuer_ok: true }, consumed = 1 } = {}) {
  const sql = [];
  const db = { query: async (text) => {
    sql.push(text.replace(/\s+/g, ' ').trim());
    if (/FROM attendance_tokens/.test(text)) return { rows: tokenRow ? [tokenRow] : [] };
    if (/FROM attendance_records/.test(text)) return { rows: record ? [record] : [] };
    if (/INSERT INTO attendance_token_scans/.test(text)) return { rows: consumed ? [{token_id: 1}] : [] };
    if (/INSERT INTO audit_logs/.test(text)) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 9 }] };
  } };
  return { sql, run: (fn) => fn(db) };
}
const args = (run) => ({ employeeId: 7, userId: 3, token: TOKEN, workDate: '2026-10-19', photoId: PHOTO, run });

test('applyScan shares the token lock, reserves an employee receipt, then writes attendance', async () => {
  const { sql, run } = fakeTx();
  const out = await applyScan(args(run));
  assert.equal(out.action, ACTION.CHECK_IN);
  const at = (re) => sql.findIndex((q) => re.test(q));
  assert.match(sql[0], /FROM attendance_tokens.*FOR SHARE OF t/);
  assert.ok(at(/FROM attendance_records.*FOR UPDATE/) > 0);
  assert.ok(at(/INSERT INTO attendance_token_scans/) < at(/FROM attendance_records.*FOR UPDATE/));
  assert.ok(at(/INSERT INTO attendance_records/) > at(/INSERT INTO attendance_token_scans/));
  assert.ok(at(/INSERT INTO audit_logs/) > at(/INSERT INTO attendance_records/));
});

test('applyScan: a used, expired or unknown token throws before anything is written', async () => {
  for (const [tokenRow, code] of [[{ id: 1, used: true }, 'token_used'], [{ id: 1, used: false, expired: true }, 'token_expired'], [null, 'invalid_token']]) {
    const { sql, run } = fakeTx({ tokenRow });
    await assert.rejects(applyScan(args(run)), (e) => e.code === code);
    assert.equal(sql.filter((q) => /^(UPDATE|INSERT)/.test(q)).length, 0, code);
  }
});

test('applyScan: a completed day throws before the token is consumed', async () => {
  const { sql, run } = fakeTx({ record: { id: 5, status: 'present', check_in_at: T, check_out_at: T } });
  await assert.rejects(applyScan(args(run)), (e) => e.code === 'already_checked_out');
  assert.equal(sql.some((q) => /UPDATE attendance_tokens/.test(q)), false);
});

test('applyScan: a duplicate employee receipt is 409 token_already_scanned', async () => {
  const { run } = fakeTx({ consumed: 0 });
  await assert.rejects(applyScan(args(run)), (e) => e.status === 409 && e.code === 'token_already_scanned');
});

test('applyScan rejects a malformed date or photo id before opening a transaction', async () => {
  let opened = false;
  const run = () => { opened = true; };
  await assert.rejects(applyScan({ ...args(run), workDate: '19/10/2026' }));
  await assert.rejects(applyScan({ ...args(run), photoId: 'https://evil/x.jpg' }));
  assert.equal(opened, false);
});

test('statusAfterCheckOut: incomplete becomes late/present again, other statuses are kept', () => {
  assert.equal(statusAfterCheckOut({ status: 'incomplete', late_minutes: 12 }), 'late');
  assert.equal(statusAfterCheckOut({ status: 'incomplete', late_minutes: 0 }), 'present');
  assert.equal(statusAfterCheckOut({ status: 'late', late_minutes: 5 }), 'late');
  assert.equal(statusAfterCheckOut({ status: 'present', late_minutes: 0 }), 'present');
});

// ---- 2.15 submitScan (upload before commit) and companyDate
import { submitScan, companyDate } from '../src/services/attendance.js';

function spy({ uploadFails = false, applyFails = null, decideFails = null, deleteFails = false } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      photos: {
        upload: async () => { calls.push('upload'); if (uploadFails) throw Object.assign(new Error('storage down'), { status: 502 }); return PHOTO; },
        delete: async (id) => { calls.push(`delete:${id}`); if (deleteFails) throw new Error('cloudinary down'); return 'ok'; },
      },
      apply: async (a) => { calls.push(`apply:${a.photoId}`); if (applyFails) throw applyFails; return { action: 'check_in', record: { id: 1 } }; },
      decide: async () => { calls.push('decide'); if (decideFails) throw decideFails; },
      log: (m) => calls.push(`log:${m}`),
    },
  };
}
const submit = (deps) => submitScan({ employeeId: 7, userId: 3, token: TOKEN, photo: Buffer.from([1]), workDate: '2026-10-19', ...deps });

test('submitScan: decide, upload, then apply with the uploaded id; nothing is deleted on success', async () => {
  const { calls, deps } = spy();
  const out = await submit(deps);
  assert.equal(out.action, 'check_in');
  assert.deepEqual(calls, ['decide', 'upload', `apply:${PHOTO}`]);
});

test('submitScan: a refusal (already checked out, on leave) happens before any upload', async () => {
  const { calls, deps } = spy({ decideFails: Object.assign(new Error('done'), { code: 'already_checked_out' }) });
  await assert.rejects(submit(deps), (e) => e.code === 'already_checked_out');
  assert.deepEqual(calls, ['decide']);
});

test('submitScan: upload failure means no transaction and nothing to delete', async () => {
  const { calls, deps } = spy({ uploadFails: true });
  await assert.rejects(submit(deps), (e) => e.status === 502);
  assert.deepEqual(calls, ['decide', 'upload']);
});

test('submitScan: a failed transaction deletes the uploaded photo and rethrows the ORIGINAL error', async () => {
  const boom = Object.assign(new Error('db write failed'), { code: 'db_boom' });
  const { calls, deps } = spy({ applyFails: boom });
  await assert.rejects(submit(deps), (e) => e === boom);
  assert.deepEqual(calls, ['decide', 'upload', `apply:${PHOTO}`, `delete:${PHOTO}`]);
});

test('submitScan: a refusal inside the transaction (token race) also cleans up the photo', async () => {
  const { calls, deps } = spy({ applyFails: Object.assign(new Error('used'), { code: 'token_used' }) });
  await assert.rejects(submit(deps), (e) => e.code === 'token_used');
  assert.ok(calls.includes(`delete:${PHOTO}`));
});

test('submitScan: if the cleanup itself fails, the original error still wins and only a hashed orphan reference is logged', async () => {
  const boom = new Error('db write failed');
  const { calls, deps } = spy({ applyFails: boom, deleteFails: true });
  await assert.rejects(submit(deps), (e) => e === boom);
  const output = calls.filter((c) => c.startsWith('log:')).join(' ');
  assert.match(output, /log:\[orphan-photo\] cleanup failed; reference=[a-f0-9]{16}/);
  assert.ok(!output.includes(PHOTO));
});

test('companyDate uses the company timezone, not UTC', () => {
  const t = new Date('2026-10-19T22:30:00Z');
  assert.equal(companyDate(t, 'Africa/Addis_Ababa'), '2026-10-20'); // UTC+3 is already tomorrow
  assert.equal(companyDate(t, 'UTC'), '2026-10-19');
  assert.equal(companyDate(new Date('2026-10-19T00:30:00Z'), 'America/New_York'), '2026-10-18');
  assert.match(companyDate(), /^\d{4}-\d{2}-\d{2}$/);
});

// Task 2.19: the defaults must come from config.company.timezone (a wrong key silently fell back to the server's zone).
test('companyDate / companyTime default to the company timezone, not the server zone', async () => {
  const { companyDate, companyTime } = await import('../src/services/attendance.js');
  const { config } = await import('../src/config.js');
  const instant = new Date('2026-10-28T21:30:00Z'); // 00:30 next day in Addis Ababa (UTC+3), still the 28th in UTC
  const expectDate = new Intl.DateTimeFormat('en-CA', { timeZone: config.company.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  assert.equal(companyDate(instant), expectDate);
  if (config.company.timezone === 'Africa/Addis_Ababa') {
    assert.equal(companyDate(instant), '2026-10-29');
    assert.equal(companyTime(instant), '00:30');
  }
  assert.equal(companyTime(null), null);
  assert.equal(companyTime('nonsense'), null);
  assert.equal(companyTime(instant, 'UTC'), '21:30');
});
