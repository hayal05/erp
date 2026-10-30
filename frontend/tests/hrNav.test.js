import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HR_NAV, QR_PATH, ROLE_LABEL, isQrPath, layoutMode, initials, formatClock } from '../src/components/hrNav.js';

test('sidebar includes Settlements and Announcements and keeps Departments right after Employees', () => {
  assert.deepEqual(HR_NAV.map((i) => i.label),
    ['Dashboard', 'Employees', 'Departments', 'Attendance', 'QR Attendance', 'Leave', 'Payroll', 'Settlements', 'Internal vacancies', 'Announcements', 'Approvals', 'Access Management', 'Settings']);
});

test('Departments points at /hr/departments and is a prefix item, so it stays active on /hr/departments/:id', () => {
  const item = HR_NAV.find((i) => i.key === 'departments');
  assert.equal(item.to, '/hr/departments');
  assert.equal(item.end, undefined); // react-router NavLink then matches the detail route too
  assert.ok('/hr/departments/12'.startsWith(`${item.to}/`));
  assert.deepEqual(HR_NAV.filter((i) => !i.end && '/hr/departments/12'.startsWith(`${i.to}/`)).map((i) => i.key), ['departments']); // exact-match items (Dashboard) and the others do not claim it
});

test('nav paths are unique, live under /hr, and only Dashboard is an exact-match item', () => {
  const paths = HR_NAV.map((i) => i.to);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every((p) => p === '/hr' || p.startsWith('/hr/')));
  assert.deepEqual(HR_NAV.filter((i) => i.end).map((i) => i.key), ['dashboard']);
  assert.ok(paths.includes(QR_PATH));
});

test('locked mode: only the QR page (with or without a trailing slash) is allowed', () => {
  assert.equal(isQrPath('/hr/qr'), true);
  assert.equal(isQrPath('/hr/qr/'), true);
  for (const p of ['/hr', '/hr/employees', '/hr/departments', '/hr/departments/3', '/hr/qr/extra', '/hr/qrx', '/hr/QR', '', undefined]) {
    assert.equal(isQrPath(p), false, String(p));
  }
});

test('initials: first + last word, uppercased, safe on junk', () => {
  assert.equal(initials('Hana Tesfaye'), 'HT');
  assert.equal(initials('  abebe   kebede  bekele '), 'AB');
  assert.equal(initials('Madonna'), 'M');
  for (const bad of ['', '   ', null, undefined]) assert.equal(initials(bad), '?');
});

test('formatClock shows weekday, day, month and 24 h time', () => {
  const s = formatClock(new Date(2026, 9, 19, 14, 5), 'en-GB');
  assert.match(s, /Monday/); assert.match(s, /19/); assert.match(s, /October/); assert.match(s, /14:05$/);
  assert.match(formatClock(new Date(2026, 9, 19, 0, 7), 'en-GB'), /00:07$/);
});

test('role labels', () => {
  assert.equal(ROLE_LABEL.hr, 'HR Administrator');
});

test('layoutMode: unlocked is normal; locked shows the QR shell or redirects everything else', () => {
  assert.equal(layoutMode(false, '/hr/employees'), 'normal');
  assert.equal(layoutMode(false, '/hr/qr'), 'normal');
  assert.equal(layoutMode(true, '/hr/qr'), 'locked');
  assert.equal(layoutMode(true, '/hr/qr/'), 'locked');
  for (const p of ['/hr', '/hr/employees', '/hr/departments', '/hr/departments/3', '/hr/payroll', '/hr/qr/extra', '/hr/QR', '/portal', '/'])
    assert.equal(layoutMode(true, p), 'redirect', p);
});
