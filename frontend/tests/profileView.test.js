import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tenure, employmentLabel } from '../src/pages/portal/profileView.js';
test('tenure counts complete calendar months and handles future starters', () => {
  assert.equal(tenure('2025-08-30','2026-10-29'), '1 year, 1 month');
  assert.equal(tenure('2025-10-29','2026-10-29'), '1 year');
  assert.equal(tenure('2026-10-01','2026-10-29'), 'Less than a month');
  assert.equal(tenure('2026-11-01','2026-10-29'), 'Not started');
});
test('employment labels are readable', () => assert.equal(employmentLabel('full_time'), 'full time'));
