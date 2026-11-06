import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { signIn } from './hrClient.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused/reports_rollout';
const db = new PGlite({ extensions: { btree_gist } });
const { pool } = await import('../src/db/pool.js');
const query = (sql, args) => db.query(sql, args);
pool.query = query;
pool.connect = async () => ({ query, release() {} });
const { app } = await import('../src/server.js');
const { seedAdmin } = await import('../src/db/seed.js');
const { hashPassword } = await import('../src/services/password.js');
const { companyDate } = await import('../src/services/attendance.js');

const reports = '/api/reports';
const month = '2026-09';
const from = month + '-01';
const to = month + '-30';
const password = 'report-test-password';
const pdfReader = spawnSync('pdftotext', ['-v']).status === 0;
let admin, employee, reviewer, adminId, employeeId, departmentId;

async function checked(response, status = 200) {
  const result = await response;
  assert.equal(result.status, status, `${result.req.path}: ${JSON.stringify(result.body)}`);
  return result;
}

before(async () => {
  const dir = new URL('../../database/migrations/', import.meta.url);
  for (const name of (await fs.readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await fs.readFile(new URL(name, dir), 'utf8'));
  }
  adminId = (await seedAdmin({ username: 'root', password })).id;
  admin = await signIn(app, { username: 'root', password });
  const { rows: [department] } = await query("INSERT INTO departments(name) VALUES('Operations') RETURNING id");
  departmentId = Number(department.id);
  const { rows: [other] } = await query("INSERT INTO departments(name) VALUES('Finance') RETURNING id");
  const { rows: [position] } = await query("INSERT INTO positions(name,department_id) VALUES('Analyst',$1) RETURNING id", [departmentId]);
  const { rows: [shift] } = await query("SELECT id FROM shifts WHERE name='Standard'");
  const hash = await hashPassword(password);
  for (const [username, department] of [['report.employee', other.id], ['report.reviewer', departmentId]]) {
    const { rows: [user] } = await query("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$1,$2,'employee') RETURNING id", [username, hash]);
    const { rows: [staff] } = await query(`
      INSERT INTO employees(employee_code,user_id,department_id,shift_id,gender,date_of_birth,field_of_study,start_date)
      VALUES($1,$2,$3,$4,'female','1990-05-10','Economics','2020-01-01') RETURNING id`, [username, user.id, department, shift.id]);
    if (username === 'report.employee') {
      employeeId = Number(staff.id);
      employee = await signIn(app, { username, password });
    } else {
      reviewer = await signIn(app, { username, password });
      const role = await checked(admin.post('/api/custom-access/roles').send({ name: 'Attendance reviewer', activities: ['attendance.manage'] }), 201);
      await checked(admin.post(`/api/custom-access/employees/${staff.id}/custom-grants`).send({
        roleId: role.body.id, scopeType: 'departments', departmentIds: [departmentId], employeeIds: [],
      }), 201);
    }
  }

  await db.exec(`
    INSERT INTO salary_profiles(employee_id,basic_minor,allowance_minor) SELECT id,250000,10000 FROM employees;
    INSERT INTO income_tax_brackets(from_minor,rate,fixed_deduction_minor) VALUES(0,15,0);
    INSERT INTO attendance_records(employee_id,work_date,status) SELECT id,'${from}','absent' FROM employees;
    INSERT INTO leave_requests(employee_id,leave_type_id,start_date,end_date,days,reason)
      SELECT e.id,lt.id,'2026-09-02','2026-09-02',1,'Fixture' FROM employees e CROSS JOIN leave_types lt WHERE lt.code='annual';
  `);
  const payroll = (await checked(admin.post('/api/payroll/periods').send({ month }), 201)).body;
  await checked(admin.post(`/api/payroll/periods/${payroll.id}/approve`).send({}));
  await checked(admin.post(`/api/payroll/periods/${payroll.id}/pay`).send({ paidOn: to }));
  await checked(admin.post(`/api/settlements/${payroll.id}/payments`).send({
    kind: 'income_tax', amountMinor: 100, paymentDate: companyDate(),
    reference: 'REPORT-QA', requestId: 'fbd7472a-15ae-4923-bae2-7dfb9e1f5a70',
  }), 201);

  const vacancy = await checked(admin.post('/api/vacancies').send({
    title: 'Analyst vacancy', departmentId, positionId: Number(position.id),
    closingOn: '2099-12-31', status: 'open',
  }), 201);
  await checked(employee.post(`/api/vacancies/${vacancy.body.id}/apply`).send({}), 201);
  await checked(admin.post('/api/announcements').send({ title: 'QA announcement', body: 'Internal notice', status: 'draft' }), 201);
  const attendance = (await query('SELECT id FROM attendance_records WHERE employee_id=$1', [employeeId])).rows[0];
  await query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,reason,details)
    VALUES($1,'attendance.correct','attendance_record',$2,'Verified absence','{"changes":{"status":{"from":"incomplete","to":"absent"}}}')`, [adminId, String(attendance.id)]);
  const scopedAttendance = (await query(`SELECT a.id FROM attendance_records a JOIN employees e ON e.id=a.employee_id
    WHERE e.department_id=$1`, [departmentId])).rows[0];
  const pending = await checked(reviewer.patch(`/api/attendance-records/${scopedAttendance.id}`).send({
    status: 'on_leave', reason: 'Fixture review',
  }), 202);
  await checked(admin.post(`/api/change-requests/${pending.body.requestId}/reject`).send({ reason: 'Fixture decision' }));
}, { timeout: 60_000 });

after(() => db.close());

function exportFile(client, path) {
  return client.get(path).buffer(true).parse((stream, done) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('end', () => done(null, Buffer.concat(chunks)));
    stream.once('error', done);
  });
}

async function inspectFile(response, report, format, rowCount) {
  assert.equal(response.status, 200, `${report.id}.${format}: ${response.body}`);
  assert.match(response.headers['content-disposition'], new RegExp(`filename="${report.id}-[^"]+\\.${format}"`));
  assert.match(response.headers['cache-control'], /no-store/);
  const bytes = response.body;
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.getCell('A1').value, report.title);
    assert.equal(sheet.getCell('D3').value, rowCount);
    assert.equal(sheet.rowCount, rowCount + 4);
    return sheet;
  }
  if (format === 'docx') {
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const document = await zip.file('word/document.xml').async('string');
    assert.ok(document.includes(report.title), report.id);
    if (rowCount) assert.ok(document.includes('<w:tbl>'), report.id);
    return document;
  }
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.match(bytes.subarray(-128).toString(), /startxref\s+\d+\s+%%EOF/);
  if (pdfReader) {
    const read = spawnSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' });
    assert.equal(read.status, 0, read.stderr);
    assert.ok(read.stdout.replace(/\s+/g, ' ').includes(report.title), report.id);
    return read.stdout;
  }
}

function catalogFilters(report) {
  const values = { date: from, month, from, to, year: '2026', employeeId, area: 'all' };
  const attendanceRange = ['attendance-corrections', 'attendance-exceptions'].includes(report.id);
  return new URLSearchParams(report.filters.filter(filter => filter.required || (attendanceRange && ['from', 'to'].includes(filter.key)))
    .map(filter => [filter.key, values[filter.key]]));
}

test('all advertised reports preview and every advertised export opens', { timeout: 60_000 }, async () => {
  assert.equal((await request(app).get(reports)).status, 401);
  assert.deepEqual((await checked(employee.get(reports))).body.items, []);
  const { items } = (await checked(admin.get(reports))).body;
  assert.equal(items.length, 32);
  assert.equal(new Set(items.map(report => report.id)).size, items.length);
  for (const report of items) {
    const base = `${reports}/${report.id}`;
    const filters = catalogFilters(report);
    const preview = await checked(admin.get(`${base}/preview?${filters}`));
    assert.ok(Array.isArray(preview.body.items), report.id);
    assert.ok(Number.isInteger(preview.body.total), report.id);
    assert.equal((await employee.get(`${base}/preview?${filters}`)).status, 403, report.id);
    for (const format of report.formats) {
      const path = `${base}/export.${format}?${filters}`;
      await inspectFile(await exportFile(admin, path), report, format, preview.body.total);
      assert.equal((await employee.get(path)).status, 403, path);
    }
  }
});

test('empty results export readable files and scoped requests cannot widen access', async () => {
  const { items } = (await checked(admin.get(reports))).body;
  const monthly = items.find(report => report.id === 'monthly-attendance');
  const filter = '?month=2098-01';
  const base = reports + '/monthly-attendance';
  assert.deepEqual((await checked(admin.get(base + '/preview' + filter))).body.items, []);
  for (const format of monthly.formats) await inspectFile(await exportFile(admin, base + '/export.' + format + filter), monthly, format, 0);
  const scoped = (await checked(reviewer.get(base + '/preview?month=' + month))).body.items;
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].employeeCode, 'report.reviewer');
  const deniedScope = '?month=' + month + '&employeeId=' + employeeId;
  const sheet = await inspectFile(await exportFile(reviewer, base + '/export.xlsx' + deniedScope), monthly, 'xlsx', 0);
  assert.ok(!JSON.stringify(sheet.getSheetValues()).includes('report.employee'));
  assert.equal((await reviewer.get(reports + '/payroll-register/export.xlsx?month=' + month)).status, 403);
  const locked = await signIn(app, { username: 'root', password });
  await checked(locked.post('/api/qr/lock').send({}));
  assert.equal((await locked.get(base + '/export.xlsx?month=' + month)).status, 423);
});

test('a full month of 1,000 employees exports and oversized detail requests can be narrowed', { timeout: 60_000 }, async () => {
  const { rows: [shift] } = await query("SELECT id FROM shifts WHERE name='Standard'");
  await query(`
    WITH people AS (
      INSERT INTO users(username,full_name,password_hash,role)
      SELECT 'bulk-' || lpad(n::text,4,'0'), 'Bulk Employee ' || lpad(n::text,4,'0'), 'fixture', 'employee'
      FROM generate_series(1,998) n RETURNING id, username
    )
    INSERT INTO employees(employee_code,user_id,department_id,shift_id,gender,date_of_birth,field_of_study,start_date)
      SELECT username,id,$1,$2,'male','1990-01-01','Economics','2020-01-01' FROM people
  `, [departmentId, shift.id]);
  await query(`
    INSERT INTO attendance_records(employee_id,work_date,status)
    SELECT e.id, day::date, 'absent' FROM employees e
    CROSS JOIN generate_series($1::date,$2::date,interval '1 day') day
    ON CONFLICT (employee_id,work_date) DO NOTHING
  `, [from, to]);
  const { items } = (await checked(admin.get(reports))).body;
  const monthly = items.find(report => report.id === 'monthly-attendance');
  const base = reports + '/monthly-attendance';
  const filters = '?month=' + month;
  const preview = (await checked(admin.get(base + '/preview' + filters + '&page=10&pageSize=100'))).body;
  assert.equal(preview.total, 1000);
  assert.ok(preview.items.every(row => row.total === 30));
  for (const format of monthly.formats) {
    const output = await inspectFile(await exportFile(admin, base + '/export.' + format + filters), monthly, format, 1000);
    if (format === 'xlsx') assert.equal(output.getCell('I1004').value, 30);
    if (format === 'docx') assert.ok(output.includes('bulk-0998'));
    if (format === 'pdf' && pdfReader) assert.ok(output.includes('bulk-0998'));
  }
  const exceptions = reports + '/attendance-exceptions/export.xlsx?from=' + from + '&to=';
  const boundary = await exportFile(admin, exceptions + month + '-05');
  await inspectFile(boundary, items.find(report => report.id === 'attendance-exceptions'), 'xlsx', 5000);
  const oversized = await admin.get(exceptions + to);
  assert.equal(oversized.status, 422, JSON.stringify(oversized.body));
  assert.equal(oversized.body.error.code, 'export_limit');
  assert.match(oversized.body.error.message, /Narrow the filters/i);
});
