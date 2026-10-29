import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attendanceRange } from '../src/services/attendanceRange.js';
test('today overrides date filters with the company date', () => {
  assert.deepEqual(attendanceRange({ view: 'today', from: '2020-01-01' }, '2026-10-29'), { from: '2026-10-29', to: '2026-10-29' });
});
test('archive excludes today across year and leap-day boundaries', () => {
  assert.deepEqual(attendanceRange({ view: 'archive' }, '2026-01-01'), { to: '2025-12-31' });
  assert.deepEqual(attendanceRange({ view: 'archive' }, '2024-03-01'), { to: '2024-02-29' });
});
test('archive preserves earlier end dates and caps later ones', () => {
  assert.deepEqual(attendanceRange({ view: 'archive', to: '2026-10-10' }, '2026-10-29'), { to: '2026-10-10' });
  assert.deepEqual(attendanceRange({ view: 'archive', to: '2026-11-01' }, '2026-10-29'), { to: '2026-10-28' });
});
test('existing API clients without a view retain their date range', () => {
  assert.deepEqual(attendanceRange({}, '2026-10-29'), {});
});
