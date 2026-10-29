# Access separation — Task 1 foundation

Employee registration continues to create an employee identity. HR, Finance and Admin
are additional access grants; granting or removing them must never replace or delete
that identity or its attendance, leave, salary and payslip records.

The central policy lives in backend/src/services/permissions.js. requirePermission
in backend/src/middleware/auth.js enforces the policy plus the existing session lock.
Unknown permissions fail at route registration. Unknown grants fail closed.

## Responsibility boundaries

- Employee: own profile, attendance, leave, payslips and active announcements.
- HR: employee/organization/salary-profile management, attendance and QR, leave,
  announcements, draft payroll preparation; read payroll settings and deductions.
- Finance: read employment/attendance/leave information needed for payroll, review,
  approve and pay payroll, manage payroll settings and deductions, costs and settlements.
- Admin: all business permissions, including issuing access and access audit history.
- HR and Finance can both be granted. Each keeps employee self-service access.
- Audit permissions are separated into HR, Finance and access-management domains;
  the audit-bar implementation must enforce record and field visibility as well.

## Staged rollout

Task 1 adds the policy and guard only. Existing endpoint role guards remain unchanged,
so this change neither grants nor revokes live access. It does not yet split production
workspaces. This avoids treating the current broad `hr` role as the new restricted HR grant.

Task 2 must store grants and load user.accessRoles from the database for every request,
explicitly grant Admin access to the existing administrator, and preserve employee identity.
Never obtain grants from request bodies, query parameters, headers or a login-supplied role.
Tasks 3–7 implement issuance, workspace switching, endpoint conversion and immediate revocation.
When converting mixed-purpose routers, use per-operation permissions: payroll.prepare,
payroll.approve and payroll.pay must not share one broad payroll write guard.

The planned audit bar and change log remain Task 8; integration testing remains Task 9.
No migrations or frontend changes are required for this foundation commit.
