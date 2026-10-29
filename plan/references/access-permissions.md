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

## Task 2 — persisted grants and session loading

Migration 010 stores access_grants separately from users.role and employee records.
Each grant has its own lifecycle: one active grant per user/role, immutable original
facts, a recorded reason and actor for revocation, and a new row when reissued.
Database triggers retain history and append grant/revocation events to audit_logs.
Existing legacy hr accounts receive an explicit Admin grant because they already
had unrestricted access. No employee is promoted by migration. New installations'
seed administrator also receives an explicit Admin grant.

loadSession reads active grants in its existing session query on every request;
login, /auth/me and password-change responses expose accessRoles and effective
permissions consistently. Grants are never taken from client role fields. Thus a
permission-guarded request sees revocation without waiting for login or cookie expiry.
User deactivation and password-change gates still apply independently.

Production endpoints still use their legacy role guards until Tasks 5–6. This task
does not yet expose grant/revoke APIs, workspace switching or Access Management.
Task 3 must use the authenticated Admin as actor; Task 7 adds the last-active-Admin
and other account safeguards before access issuance is complete.
