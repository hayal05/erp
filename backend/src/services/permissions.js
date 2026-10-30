// Access roles are additional server-loaded grants, not employee identities or request-body roles.
// Task 2 will populate user.accessRoles from persisted grants on every authenticated request.
export const ACCESS_ROLES = Object.freeze(['hr', 'finance', 'admin']);
export const PERMISSIONS = Object.freeze([
  'dashboard.read','organization.read','attendance.qr.read','announcements.admin_read','settlements.read','access.read',
  'self.profile', 'self.attendance', 'self.leave', 'self.payslips',
  'employees.read', 'employees.manage', 'organization.manage', 'salary_profiles.manage',
  'attendance.read', 'attendance.manage', 'attendance.qr', 'leave.read', 'leave.manage',
  'announcements.read', 'announcements.manage', 'payroll.read', 'payroll.prepare',
  'payroll.approve', 'payroll.pay', 'payroll_settings.read', 'payroll_settings.manage',
  'deductions.read', 'deductions.manage', 'company_costs.read', 'settlements.manage',
  'approvals.read', 'access.manage', 'audit.hr', 'audit.finance', 'audit.access',
]);
const employeePermissions = Object.freeze(['self.profile', 'self.attendance', 'self.leave', 'self.payslips', 'announcements.read']);
const sharedManagementReads=['dashboard.read','organization.read','attendance.qr.read','announcements.admin_read','company_costs.read','settlements.read','access.read'];
const hrPermissions = Object.freeze([
  ...sharedManagementReads,
  'employees.read', 'employees.manage', 'organization.manage', 'salary_profiles.manage',
  'attendance.read', 'attendance.manage', 'attendance.qr', 'leave.read', 'leave.manage',
  'announcements.read', 'announcements.manage', 'payroll.read', 'payroll.prepare',
  'payroll_settings.read', 'deductions.read', 'audit.hr', 'approvals.read',
]);
const financePermissions = Object.freeze([
  ...sharedManagementReads,
  'employees.read', 'attendance.read', 'leave.read', 'announcements.read', 'payroll.read',
  'payroll.approve', 'payroll.pay', 'payroll_settings.read', 'payroll_settings.manage',
  'deductions.read', 'deductions.manage', 'company_costs.read', 'settlements.manage', 'audit.finance', 'approvals.read',
]);
export const ROLE_PERMISSIONS = Object.freeze({
  hr: hrPermissions, finance: financePermissions,
  // Admin may manage all business areas. Self-service still requires an employee identity.
  admin: Object.freeze(PERMISSIONS.filter(p => !p.startsWith('self.'))),
});
export function permissionsFor(user) {
  if (!user || !['employee', 'hr'].includes(user.role)) return [];
  const result = new Set(user.role === 'employee' ? employeePermissions : []);
  for (const role of Array.isArray(user.accessRoles) ? user.accessRoles : []) {
    if (!ACCESS_ROLES.includes(role)) continue;
    for (const permission of ROLE_PERMISSIONS[role]) result.add(permission);
  }
  return [...result].sort();
}
export const hasPermission = (user, permission) => PERMISSIONS.includes(permission) && permissionsFor(user).includes(permission);
