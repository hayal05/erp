import test from 'node:test';
import assert from 'node:assert/strict';
import { reportPeriodRange } from '../src/pages/reportPeriod.js';

test('weekly reports run from Monday to Sunday even across a year boundary', () => {
  const expected = { from: '2025-12-29', to: '2026-01-04' };
  assert.deepEqual(reportPeriodRange('weekly', '2025-12-29'), expected);
  assert.deepEqual(reportPeriodRange('weekly', '2026-01-04'), expected);
});

test('monthly reports include the full selected month', () => {
  assert.deepEqual(reportPeriodRange('monthly', '2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(reportPeriodRange('monthly', '2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(reportPeriodRange('monthly', ''), { from: '', to: '' });
});
