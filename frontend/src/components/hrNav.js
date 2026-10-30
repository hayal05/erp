// Pure data/helpers for the HR shell (kept free of React so they are unit-tested).

// Spec §4 (updated by Phase 6): navigation items, in this order. `end` makes Dashboard active only on /hr itself.
// Departments has no `end`, so it stays highlighted on its detail page (/hr/departments/:id) as well.
export const HR_NAV = [
  { key: 'dashboard', label: 'Dashboard', to: '/hr', end: true },
  { key: 'employees', label: 'Employees', to: '/hr/employees' },
  { key: 'departments', label: 'Departments', to: '/hr/departments' },
  { key: 'attendance', label: 'Attendance', to: '/hr/attendance' },
  { key: 'qr', label: 'QR Attendance', to: '/hr/qr' },
  { key: 'leave', label: 'Leave', to: '/hr/leave' },
  { key: 'payroll', label: 'Payroll', to: '/hr/payroll' },
  { key: 'settlements', label: 'Settlements', to: '/hr/settlements' },
  { key: 'vacancies', label: 'Internal vacancies', to: '/hr/vacancies' },
  { key: 'announcements', label: 'Announcements', to: '/hr/announcements' },
  { key: 'approvals', label: 'Approvals', to: '/hr/approvals' },
  { key: 'access', label: 'Access Management', to: '/hr/access-management', permission: 'access.read' },
  { key: 'settings', label: 'Settings', to: '/hr/settings' },
];

export const QR_PATH = '/hr/qr';
export const ROLE_LABEL = { hr: 'HR Administrator', employee: 'Employee' };

// A locked tablet (§6.1) may only show the QR page. The server enforces this; the UI just matches it.
export const isQrPath = (pathname = '') => pathname.replace(/\/+$/, '') === QR_PATH;

// What the HR layout should render. 'redirect' sends a locked session that typed or navigated to any
// other URL (address bar, back button, old tab) to the QR page; 'locked' is the bare QR shell.
export function layoutMode(locked, pathname) {
  if (!locked) return 'normal';
  return isQrPath(pathname) ? 'locked' : 'redirect';
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

// "Monday, 19 October, 14:25" in the device's locale and time zone (display only).
export function formatClock(date, locale) {
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${day}, ${time}`;
}
