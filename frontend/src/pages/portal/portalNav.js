// Employee portal navigation (pure data). Pages arrive with their tasks: Attendance 2.19, Leave 3.5, Payslips 4.20.
export const PORTAL_NAV = [
  { key: 'home', label: 'Home', to: '/portal', end: true },
  { key: 'attendance', label: 'Attendance', to: '/portal/attendance' },
  { key: 'leave', label: 'Leave', to: '/portal/leave' },
  { key: 'vacancies', label: 'Vacancies', to: '/portal/vacancies' },
  { key: 'profile', label: 'Profile', to: '/portal/profile' },
  { key: 'payslips', label: 'Payslips', to: '/portal/payslips' },
];

export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';
