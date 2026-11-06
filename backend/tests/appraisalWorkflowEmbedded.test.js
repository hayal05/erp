import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { signIn } from './hrClient.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused/appraisal_workflow';
const db = new PGlite({ extensions: { btree_gist } });
const { pool } = await import('../src/db/pool.js');
const query = (sql, args) => db.query(sql, args);
pool.query = query;
pool.connect = async () => ({ query, release() {} });
const { app } = await import('../src/server.js');
const { seedAdmin } = await import('../src/db/seed.js');
after(() => db.close());

const base = '/api/appraisals';
const results = '/api/reports/appraisal-results';
const summary = '/api/reports/appraisal-summary';
const password = 'appraisal-test-password';

async function expect(response, status = 200) {
  const result = await response;
  assert.equal(result.status, status, `${result.req.path}: ${JSON.stringify(result.body)}`);
  return result.body;
}

function fileResponse(client, path) {
  return client.get(path).buffer(true).parse((stream, done) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('end', () => done(null, Buffer.concat(chunks)));
    stream.once('error', done);
  });
}

test('a clean installation completes a scoped, graded appraisal cycle from template to employee and exports', { timeout: 60_000 }, async () => {
  const dir = new URL('../../database/migrations/', import.meta.url);
  for (const name of (await fs.readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await fs.readFile(new URL(name, dir), 'utf8'));
  }
  const root = await seedAdmin({ username: 'workflow.admin', password });
  const admin = await signIn(app, { username: 'workflow.admin', password });
  const department = name => expect(admin.post('/api/departments').send({ name }), 201);
  const north = await department('North branch');
  const south = await department('South branch');
  const position = await expect(admin.post(`/api/departments/${north.id}/positions`).send({
    name: 'Officer', basicMinor: 0, allowanceMinor: 0,
    initialGrades: [{ name: 'Grade 2', basicMinor: 200000, allowanceMinor: 10000 }],
  }), 201);
  const [grade] = (await expect(admin.get(`/api/positions/${position.id}/grades`))).items;

  async function register(username, fullName, departmentId, assignment = {}) {
    const employee = await expect(admin.post('/api/employees').send({
      employeeCode: username, username, fullName, password, departmentId, ...assignment,
      gender: 'female', dateOfBirth: '1990-01-01', fieldOfStudy: 'Economics', startDate: '2025-01-01',
    }), 201);
    await query('UPDATE users SET must_change_password=false WHERE id=$1', [employee.userId]);
    return { ...employee, client: await signIn(app, { username, password }) };
  }

  const subject = await register('north.officer', 'North Officer', north.id, { positionId: position.id, jobGradeId: grade.id });
  const outsider = await register('south.officer', 'South Officer', south.id);
  const reviewer = await register('north.reviewer', 'North Reviewer', north.id);
  const approver = await register('north.approver', 'North Approver', north.id);

  async function grant(employee, name, activity) {
    const role = await expect(admin.post('/api/custom-access/roles').send({ name, activities: [activity] }), 201);
    await expect(admin.post(`/api/custom-access/employees/${employee.id}/custom-grants`).send({
      roleId: role.id, scopeType: 'departments', departmentIds: [north.id], employeeIds: [],
    }), 201);
  }
  await grant(reviewer, 'North review', 'appraisals.review');
  await grant(approver, 'North approval', 'appraisals.approve');

  const volume = randomUUID(), safety = randomUUID();
  const categories = [
    { id: randomUUID(), name: 'Delivery', weight: 7000, criteria: [{ id: volume, name: 'Target', weight: 10000,
      scoring: { method: 'higher', target: 100, cap: 100, missing: 'required', allowNotApplicable: false } }] },
    { id: randomUUID(), name: 'Quality', weight: 3000, criteria: [{ id: safety, name: 'Safety', weight: 10000,
      mandatory: { minimum: 8000, ceiling: 5999 } }] },
  ];
  const brackets = [
    { label: 'Developing', min: 0, max: 6000 }, { label: 'Meeting expectations', min: 6000, max: 10000 },
  ];
  async function publish(body) {
    const template = await expect(admin.post(base + '/templates').send(body), 201);
    const path = `${base}/templates/${template.id}`;
    await expect(admin.put(path + '/structure').send({ version: template.version, categories, brackets }));
    await expect(admin.post(path + '/publications').send({ version: template.version + 1 }), 201);
    return path;
  }
  await publish({ name: 'Company template', scope: 'company' });
  const gradeTemplate = await publish({ name: 'Officer grade scorecard', scope: 'grade', targetId: grade.id });

  const cycle = await expect(admin.post(base + '/cycles').send({
    name: 'Q4 branch review', kind: 'quarterly', startsOn: '2026-10-01', endsOn: '2026-12-31', dueOn: '2027-01-15',
  }), 201);
  const cyclePath = `${base}/cycles/${cycle.id}`;
  const assignments = [{ employeeId: subject.id, reviewerId: reviewer.userId }, { employeeId: outsider.id, reviewerId: root.id }];
  await expect(admin.put(cyclePath + '/assignments').send({
    version: 1, assignments: [assignments[0], { employeeId: outsider.id, reviewerId: reviewer.userId }],
  }), 400);
  await expect(admin.put(cyclePath + '/assignments').send({ version: 1, assignments }), 204);
  await expect(admin.post(cyclePath + '/open').send({ version: 2 }));
  const { items: pinned } = await expect(admin.get(cyclePath + '/assignments'));
  assert.equal(pinned.find(row => row.employeeId === subject.id).templateName, 'Officer grade scorecard');
  assert.equal(pinned.find(row => row.employeeId === outsider.id).templateName, 'Company template');

  // Publishing revised rules cannot alter the current cycle.
  const revised = structuredClone(categories);
  revised[0].criteria[0].scoring.target = 200;
  await expect(admin.put(gradeTemplate + '/structure').send({ version: 2, categories: revised, brackets }));
  await expect(admin.post(gradeTemplate + '/publications').send({ version: 3 }), 201);

  const mine = (await expect(reviewer.client.get(base + '/assignments'))).items;
  assert.deepEqual(mine.map(row => row.employeeId), [subject.id]);
  const id = `${cycle.id}/${subject.id}`;
  const reviewPath = base + '/reviews/' + id;
  const approvePath = base + '/approvals/' + id;
  await expect(reviewer.client.get(`${base}/reviews/${cycle.id}/${outsider.id}`), 404);
  assert.equal((await expect(reviewer.client.get(reviewPath))).template.version, 2);
  const partial = await expect(reviewer.client.put(reviewPath).send({ version: 0, inputs: { [volume]: { value: 90 } } }));
  await expect(reviewer.client.post(reviewPath + '/submit').send({ version: partial.version, inputs: partial.inputs }), 422);
  const submitted = await expect(reviewer.client.post(reviewPath + '/submit').send({
    version: partial.version, inputs: { ...partial.inputs, [safety]: { value: 70 } },
  }));
  assert.deepEqual(submitted.result.rating, { score: 84, ratingScore: 59.99, label: 'Developing', cappedBy: [safety] });
  const portalPath = '/api/my-appraisals/' + cycle.id;
  await expect(subject.client.get(portalPath), 404);
  const returned = await expect(approver.client.post(approvePath + '/decision').send({
    version: submitted.version, decision: 'return', reason: 'Add supporting evidence',
  }));
  const resubmitted = await expect(reviewer.client.post(reviewPath + '/submit').send({
    version: returned.version, inputs: returned.inputs, comment: 'Evidence verified',
  }));
  await expect(approver.client.post(approvePath + '/decision').send({ version: resubmitted.version, decision: 'approve' }));
  const own = await expect(subject.client.get(portalPath));
  assert.equal(own.template.version, 2);
  assert.deepEqual(own.result.rating, submitted.result.rating);
  assert.equal(own.comment, 'Evidence verified');
  await expect(outsider.client.get(portalPath), 404);
  const history = await expect(approver.client.get(approvePath + '/history'));
  assert.ok(history.items.some(row => row.action === 'appraisal.review.return' && row.reason === 'Add supporting evidence'));

  const filters = '?cycleId=' + cycle.id;
  const scoped = await expect(approver.client.get(results + '/preview' + filters));
  assert.deepEqual(scoped.items.map(row => row.employee), ['North Officer']);
  assert.equal((await expect(admin.get(results + '/preview' + filters))).total, 2);
  await expect(subject.client.get(results + '/export.xlsx' + filters), 403);
  const excel = await fileResponse(approver.client, results + '/export.xlsx' + filters);
  assert.equal(excel.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excel.body);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 5);
  assert.equal(sheet.getCell('C5').value, 'North Officer');
  assert.equal(sheet.getCell('H5').value, 84);
  assert.equal(sheet.getCell('I5').value, 59.99);
  const pdf = await fileResponse(approver.client, summary + '/export.pdf' + filters);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  if (spawnSync('pdftotext', ['-v']).status === 0) {
    const output = spawnSync('pdftotext', ['-layout', '-', '-'], { input: pdf.body, encoding: 'utf8' });
    assert.equal(output.status, 0, output.stderr);
    assert.match(output.stdout, /North branch/);
    assert.doesNotMatch(output.stdout, /South branch/);
  }
});
