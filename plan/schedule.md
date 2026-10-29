# Schedule (21 days, ~4 tasks/day) — tick as you go

Checkpoints: Day 4 login+employees · Day 9 full QR flow · Day 12 leave affects attendance · Day 18 payroll Draft→Approved→Paid + payslip · Day 21 deployable.


## Phase 1: Foundation  → `tasks/phase-1-foundation.md`


**Day 1: Skeleton and server**

- [x] 1.1 Create monorepo folders, both package.json files, .env.example
- [x] 1.2 server.js: config loader, /health, error handler
- [x] 1.3 pg pool (max 5) and SQL migration runner
- [x] 1.4 Migration 001: users, sessions (locked column), departments, shifts, employees, audit_logs

**Day 2: Auth backend**

- [x] 1.5 Password hashing and seed-HR-admin script
- [x] 1.6 pg-backed server sessions, HTTP-only cookies
- [x] 1.7 CSRF protection (session-bound synchronizer token + Origin check)
- [x] 1.8 Login, logout, me routes with login rate limiter

**Day 3: Guards and frontend base**

- [x] 1.9 requireAuth, requireRole middleware and audit-log helper
- [x] 1.10 Request-validation helper
- [x] 1.11 Vite, React Router, API client (CSRF header), auth context
- [x] 1.12 Login page

**Day 4: Employees and layout**

- [x] 1.13 Shared components: table, form fields, modal, button, toast + theme CSS variables (dark/light)
- [x] 1.14 HR layout: top bar, sidebar, route guard
- [x] 1.15 Employees, departments, shifts APIs (paginated, no hard delete)
- [x] 1.16 Employees page, form dialog, employee portal shell (mobile-first)
- [x] 1.17 Tests: login, role isolation, employee denied HR routes

## Phase 2: QR Attendance  → `tasks/phase-2-qr-attendance.md`


**Day 5: Lock enforcement**

- [x] 2.1 Migration 002: attendance_tokens, attendance_records (unique employee+work date)
- [x] 2.2 Lock middleware with allowlist
- [x] 2.3 Lock/unlock endpoints, unlock reauth, own rate limiter
- [x] 2.4 QR token generation (random, single-use, 45 s)

**Day 6: Tablet UI**

- [x] 2.5 QR page: clock, QR render, countdown, Generate buttons
- [x] 2.6 Locked display mode, state restored from server
- [x] 2.7 Unlock dialog
- [x] 2.8 Lock tests (written, NOT yet run)

**Day 7: Selfie capture and storage**

- [x] 2.9 Cloudinary service: private upload, signed expiring URL, delete
- [x] 2.10 Keep token across login via router state
- [x] 2.11 Scan page: front camera, preview, capture, retake, compress ~150 KB
- [x] 2.12 Submit endpoint skeleton: auth, token validation, active check

**Day 8: Attendance transaction**

- [x] 2.13 Next-action logic and duplicate guard
- [x] 2.14 Transaction: consume token + insert attendance + row lock
- [x] 2.15 Upload-before-commit with orphan photo cleanup
- [x] 2.16 Status and late-minutes (company timezone, same-day shifts)

**Day 9: HR views and tests**

- [x] 2.17 HR attendance list API (filters, pagination) and signed selfie URL
- [x] 2.18 HR attendance page, selfie viewer, correction dialog + API
- [x] 2.19 Employee attendance history and success confirmation
- [x] 2.20 Tests: expiry, replay, concurrency, check-out before check-in, private selfies

## Phase 3: Leave  → `tasks/phase-3-leave.md`


**Day 10: Backend**

- [x] 3.1 Migration 003: leave_types, leave_balances, leave_requests, holidays
- [x] 3.2 Working-day calculator (schedule + holidays)
- [x] 3.3 Leave request API (auto days, overlap + balance checks)
- [x] 3.4 HR approve/reject/remarks/balance-adjust (reasons, audited)

**Day 11: Frontend**

- [x] 3.5 Employee leave page
- [x] 3.6 HR leave page (queue, decisions, entitlements)
- [x] 3.7 Holidays and working-day settings

**Day 12: Integration**

- [x] 3.8 Approved leave feeds attendance status and absence calc
- [x] 3.9 Leave tests

## Phase 4: Payroll  → `tasks/phase-4-payroll.md`


**Day 13: Engine first**

- [x] 4.1 Migration 004: salary_profiles, payroll_settings, income_tax_brackets, deduction_items, payroll_periods, payroll_entries, payroll_entry_items
- [x] 4.2 Money utilities (integer minor units, rounding config)
- [x] 4.3 Calculation engine (gross, tax, pensions, other taxes, deductions, net, employer cost)
- [x] 4.4 Engine unit tests (2,500 -> 225 example etc.)

**Day 14: Settings backend**

- [x] 4.5 Tax bracket API with gap/overlap/no-match validation
- [x] 4.6 Pension + taxable/pensionable base settings API
- [x] 4.7 Other taxes API (predefined bases only)
- [x] 4.8a Deduction items CRUD API (HR only)
- [x] 4.8b One-time consumption rules and engine hookup (all 8 subtasks written; DB tests unrun)

**Day 15: Settings UI and profiles**

- [x] 4.9 Payroll Settings page, four tabs
- [x] 4.10 Salary profile API + edit form
- [x] 4.11 Payroll period create + generate draft

**Day 16: Workflow**

- [x] 4.12 Draft entry edit with server recalculation
- [x] 4.13 Approve: immutable snapshot, block recalc
- [x] 4.14 Mark paid with date; audit all transitions
- [x] 4.15 Unpaid-leave/absence deduction applied exactly once

**Day 17: Salary sheet UI**

- [x] 4.16 Nine-column spreadsheet table
- [x] 4.17 Row detail panel (deduction breakdown, employer cost)
- [x] 4.18 Month selector and Draft/Approved/Paid buttons
- [x] 4.19 CSV export

**Day 18: Payslips and dashboard**

- [x] 4.20 Payslip API (own approved only) and printable page
- [x] 4.21 Dashboard stats API and page
- [x] 4.22 Payroll tests: locking, snapshot, isolation

## Phase 5: Testing and Deployment  → `tasks/phase-5-testing-deploy.md`


**Day 19: Test sweep**

- [x] 5.1 Map all 17 required tests to files, fill gaps
- [x] 5.2 Run all tests, fix failures, check logs for secrets

**Day 20: Deployment**

- [x] 5.3 Production builds (frontend + backend)
- [x] 5.4 render.yaml and final .env.example
- [x] 5.5 Startup migration and memory check (<512 MB)

**Day 21: Docs and wrap-up**

- [x] 5.6 README: setup, env vars, deploy, UptimeRobot
- [x] 5.7 Backup guide, photo retention/deletion, manual attendance fallback, same-day-shift note
- [x] 5.8 Real LOC report (written; 14,343 lines total vs 9,000 ceiling = OVER, production-only 7,196; owner decision needed, see loc-report.md)
- [ ] 5.9 End-to-end check: lock, scan, selfie, attendance, leave, payroll, payslip

## Phase 6: Departments, Positions and Default Salary  → `tasks/phase-6-departments-positions.md`

Added 2026-10-29 at the owner's request, scope confirmed the same day (no auto-migration of existing employees; a position change applies the new salary by default but stays editable; ONE allowance). Planned only; nothing below is built yet.

**Day 22: Database and API**

- [x] 6.1 Migration 005: positions table and employees.position_id
- [x] 6.2 Position validation and one shared function that writes salary profiles
- [x] 6.3 Positions API (nested under departments)
- [ ] 6.4 Department API additions (positionCount, delete guard)
- [ ] 6.5 Employee create/update apply the position salary (default on position change, can be declined)
- [ ] 6.6 Backend tests

**Day 23: Frontend**

- [ ] 6.7 Sidebar "Departments" item and routes (nav becomes 8 items; update test and spec §4)
- [ ] 6.8 Departments page with Add department button
- [ ] 6.9 Positions and salary table (department detail)
- [ ] 6.10 Employee form: Position, salary preview, "Apply new position salary" checkbox
- [ ] 6.11 Frontend tests

**Day 24: Integration and release**

- [ ] 6.12 Whole-flow check (local, then deployed on a phone)
- [ ] 6.13 README, status, LOC recount, Neon backup before deploy
