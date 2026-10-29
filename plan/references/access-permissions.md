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

## Task 3 — Access Management

The Admin-only /hr/access-management page and /api/access-management routes list
registered employees, issue HR/Finance grants, revoke them with a reason, and show
paginated grant/revocation history. Admin grants are deliberately excluded from
these issuance/revocation endpoints. Granting never creates an account or changes
employee identity. Inactive employee/user accounts cannot receive new grants.
Duplicate grant/revocation requests are idempotent and retain their original audit
facts; per-employee row locks serialize issuance and revocation through the API.

The sidebar hides this page without access.manage. The API independently enforces
that permission, CSRF and session lock checks. An active grant is rechecked from the
database on subsequent requests through Task 2's session loader.

The current legacy administrator can open the page. Employees given additional
access receive their separate workspace switcher in Task 4; feature endpoint
permissions remain part of Tasks 5–6. The full audit bottom bar remains Task 8.

## Task 4 — workspace navigation

Employees still land in My employee portal. Granted staff can switch to /hr and/or
/finance; the existing non-employee administrator retains the Admin workspace at /hr.
Workspace choices come from current session permissions, not local storage or a
client-selected role. The employee switcher lives in the account dropdown to fit
small screens; management workspaces show it in the top bar.

Page guards and menus enforce workspace capability checks, including deep-link
restoration after login. Finance payroll links retain the /finance prefix. Revoked
permissions received through the existing focus/session sync remove workspace
choices and redirect unauthorized pages; a non-employee account with no workspace
gets an access-unavailable message instead of a redirect loop.

This is navigation only. Backend HR/Finance operation conversion remains Tasks 5–6;
newly granted employee accounts cannot bypass legacy server guards before that work.

## Task 5 — HR operations

HR-domain routers now enforce capabilities rather than the legacy hr identity.
Reads and writes are separated for employees, attendance, leave, salary profiles,
payroll settings and deduction items. Payroll generation, regeneration and draft
entry edits require payroll.prepare; approval and payment require their respective
Finance/Admin permissions. HR settings/deductions are read-only in the UI and API;
HR can still select an employee to inspect deductions. Company costs are hidden
from HR payroll navigation, and approval/payment actions are not offered to HR.

HR-granted employees can issue, lock and unlock the QR tablet using their own
password. QR validation requires the issuer's current active HR/Admin grant, so
revoking the grant invalidates previously issued codes. HR-granted employee users
can manage draft announcements; ordinary employees and Finance see active notices only.
Finance-specific cost/settlement endpoint conversion remains Task 6.

## Task 6 — Finance operations

Company costs and all settlement operations now require their Finance capabilities;
the overview dashboard requires Admin access because it combines management domains.
Finance uses the Task 5 per-operation payroll/settings/deduction guards to review,
approve and mark payroll paid, manage calculation settings and deduction items, and
record remittances. Finance cannot prepare/regenerate/edit drafts or alter HR facts.

Changing calculation inputs leaves approval blocked until HR regenerates/recalculates
and the table is reviewed again. Draft payroll text now explains the HR/Finance handoff
instead of incorrectly describing a Finance-visible draft as permanently locked.
Approved/paid snapshots and settlement balance/ledger protections remain unchanged.

Cross-role integration covers a Finance-only employee account, the HR-to-Finance
handoff, changed-input approval rejection, costs, partial/full settlement recording,
deduction CRUD, denial of HR mutations and immediate financial-access revocation.
Task 7 still covers account safeguards; Task 8 the audit bar; Task 9 broad integration.

## Task 7 — account safeguards

Migration 011 protects the last usable Admin at both account and grant level.
Deactivation through users.is_active or employees.status and Admin-grant revocation
share a serialized lock-row update. Updating its revision also forces conflicting
repeatable-read transactions to retry rather than using an obsolete Admin count.
Inactive users/employees do not count as an alternative usable Admin.

HR cannot change login email or activate/deactivate accounts with active privileged
grants; Admin must perform those actions. HR may still maintain job facts and ordinary
employee status. Session loading rejects inactive employee records even if a user's
is_active flag was not synchronized. Existing per-request grants enforce revocation;
the frontend refreshes session permissions after forbidden responses without replaying
writes. Account conflicts return actionable 409 responses.

The new database tests exercise direct SQL and HTTP safeguards, privileged-account
restrictions, inactive-session rejection and an alternative inactive Admin. Real
multi-connection race tests remain part of broader integration validation; the embedded
engine runs a single database session. Task 8 remains audit bars and change history.
