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

## Task 8 — record audit bars

Reusable audit bars show recorded creation, last modification and approval actor/date,
with an expandable paginated change log and manual refresh. They are attached to
employee/salary/position dialogs, department detail, attendance corrections, leave
decisions, payroll, payroll settings, announcements, access management and settlements.

The read-only API uses a fixed record registry, verifies record existence and requires
both an audit-domain permission and the record capability. Only whitelisted fields
are returned, never raw audit JSON. Unrecorded metadata stays null/Not recorded.
Before/after values appear only where the source audit event actually captured them;
records and actions are not retroactively reconstructed. Actor names reflect the
current referenced user record; dates are original event timestamps.

Payroll history combines period events and related entry recalculations, including
entries replaced by regeneration. Photo-view events are excluded from modification
history. Access history is scoped by the employee's user ID. Settings, access grants
and settlements retain their separate read permissions. Audit loading is on demand,
with no polling or background jobs. No schema migration is required for this task.


## Administrative change approvals (added before Task 9)

Migration 012 adds durable, immutable change requests. Administrative record writes
by HR and Finance return 202 with a pending request ID; they do not modify live
records. A different person with the same HR/Finance area and operation permission,
or a general Admin, must approve. General Admin's own changes apply immediately.
Dual grants never permit self-approval. Registration still creates an ordinary
employee; only Admin can issue access, immediately under the agreed Admin exception.

The queue covers employee/organization/salary changes, attendance corrections,
leave entitlement changes, announcements, payroll generation/edit/regeneration,
financial settings/deductions, payroll approval/payment and settlement recording.
Attendance check-ins, employee self-service, authentication/QR session controls and
existing employee leave submissions and HR leave decisions retain their workflows.
Review decisions do not themselves require an additional approval.

The Approvals sidebar page is available in both workspaces and to Admin. It provides
pending/all/my filters, pagination, protected proposed-value previews, approve,
reasoned rejection and requester withdrawal. It has no polling/background worker.
Shared API handling reports submitted-for-approval and prevents existing forms from
treating queued writes as saved records. A successful approval returns the applied
operation result; retries return the final status without executing again.

Application rechecks both accounts and current grants, then dispatches through the
same administrative router, permission guards, validation and business rules, using
one transaction for business writes, original actor audit, reviewer audit and final
decision. Payroll approved_by_user_id records the final reviewer; original operation
audit keeps the submitting actor. Related entry/settlement approval events remain
visible in existing record histories. Failures roll back and leave the request pending.

Pending sensitive bodies use authenticated AES-GCM encryption derived from
SESSION_SECRET; read APIs only expose protected previews. Final decisions discard
ciphertext. Rotating SESSION_SECRET invalidates pending encrypted requests: reject
or withdraw and submit them again. Proposal fields and final decisions cannot be
rewritten/deleted through ordinary SQL updates/deletes. Audit remains append-only.

Stale detection is deliberately conservative: it fingerprints the affected tables,
not just the edited row. Changes elsewhere in those tables (including attendance
inputs while payroll is pending) can require withdrawing and resubmitting a request.
Review takes short database table locks in a consistent order and rechecks the
fingerprint before application. Ordinary reads remain available. This favors refusing
an obsolete proposal; record-level narrowing can follow after broad integration.

Embedded integration covers separate HR/Finance reviewers, Admin exception,
self/cross-area denial, pending deduplication, restart recovery, encrypted credentials,
revocation, stale proposals, rejection/withdrawal, immutable history, rollback on audit
failure and the full payroll-to-settlement workflow. Existing role/safeguard/audit
regressions explicitly submit and review their writes with a separate Admin. Embedded
PostgreSQL uses one connection; native multi-connection race verification and the
remaining broad Task 9 integration are not represented as completed by these checks.


## Dedicated audit bottom bar

The management shell now includes a persistent footer below Admin, HR and Finance
pages. It displays the current section's latest modifying actor/date and the matching
approval, with an expandable paginated change log. Sidebar section clicks reload
the footer, including clicks on the already active section. These are latest events
across that section;
individual record audit cards remain available in their dialogs/detail views.

The footer reserves its measured height so it does not cover page controls or the
last table row. It adapts to phone widths, supports keyboard close/focus return and
safe-area padding, and stays below navigation drawers and modal dialogs. Locked QR
screens and the employee portal do not display management audit information.

A read-only /api/audit-history?area= endpoint filters fixed section/entity sources
using the same operation and audit-domain permissions as individual records.
Approval-request events additionally check requester or eligible departmental review
visibility. Only whitelisted changed fields are returned; raw audit details and
credentials are excluded. Workspace summaries exclude proposal-only events so a
pending proposal is not reported as a modification of a live business record.

No migration, worker, polling or additional environment configuration is required.


### Compact audit footer

The collapsed footer has exactly two rows: Modified by (actor/date) and Approved by
(actor/date), with a Not authorised tag when the latest modification has no matching
later approval. An older approval or an approval of another record is not reused.
Summary selection breaks equal transaction timestamps using the audit event ID.

The compact change-log control sits to the right of both rows and uses an accessible
icon button on phones. Titles, record references, descriptions and the Refresh button
are removed from the collapsed bar. The expanded log retains the detail table and
pagination. Clicking any management sidebar function reloads its audit data and
resets log pagination, including re-clicking the current function; no polling is added.


### Audit footer visibility

The footer is shown only for editable administrative sections when the current user
has a corresponding write capability. Dashboard/workspace home, QR Attendance,
Leave, Company Costs, Approvals and unknown routes do not mount it. Read-only views
such as HR's payroll settings also omit it. Editable employee, organization,
attendance correction, payroll, financial settings, settlement, announcement and
access-management pages retain it according to the current user's permissions.

Hidden footers perform no audit fetch and reserve no footer space. Existing record
history cards remain available where provided. Active-section re-click refresh and
the compact two-row layout continue on pages that display the footer.
