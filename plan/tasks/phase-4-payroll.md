# Phase 4: Payroll  (est. ~2,010 LOC)

Format: **Read** = reference to open first · **Open** = files to create/edit · **Done when** = acceptance check.


## Day 13: Engine first

### 4.1 Migration 004: salary_profiles, payroll_settings, income_tax_brackets, deduction_items, payroll_periods, payroll_entries, payroll_entry_items
- [x] Status
- **Read:** references/spec-digest.md §21
- **Open:** `database/migrations/004_payroll.sql`
- **Done when:** Migration runs clean

### 4.2 Money utilities (integer minor units, rounding config)
- [x] Status
- **Read:** references/spec-digest.md §17
- **Open:** `backend/src/services/money.js`
- **Done when:** No float error in sums

### 4.3 Calculation engine (gross, tax, pensions, other taxes, deductions, net, employer cost)
- [x] Status
- **Read:** references/spec-digest.md §13-§17
- **Open:** `backend/src/services/payrollEngine.js`
- **Done when:** Pure functions; single module

### 4.4 Engine unit tests (2,500 -> 225 example etc.)
- [x] Status
- **Read:** references/spec-digest.md §26 #12-15
- **Open:** `backend/tests/payrollEngine.test.js`
- **Done when:** Tests 12,13,14,15 pass


## Day 14: Settings backend

### 4.5 Tax bracket API with gap/overlap/no-match validation
- [x] Status
- **Read:** references/spec-digest.md §13
- **Open:** `backend/src/routes/payrollSettings.js`
- **Done when:** Invalid brackets blocked

### 4.6 Pension + taxable/pensionable base settings API
- [x] Status
- **Read:** references/spec-digest.md §13, §14
- **Open:** `backend/src/routes/payrollSettings.js`
- **Done when:** Rates and bases persist

### 4.7 Other taxes API (predefined bases only)
- [x] Status
- **Read:** references/spec-digest.md §15
- **Open:** `backend/src/routes/payrollSettings.js`
- **Done when:** Unknown base rejected

### 4.8a Deduction items CRUD API (HR only)
- [x] Status
- **Read:** references/spec-digest.md §16; the `deduction_items` section of `database/migrations/004_payroll.sql`
- **Open:** `backend/src/routes/deductions.js` (new), `backend/src/services/payrollSchemas.js` (add parser), `backend/src/services/dbErrors.js` (any mappings), `backend/src/server.js` (mount router)
- **Build:** list per employee, create, partial PATCH, delete. Amount = positive minor units; `kind` = advance | loan | penalty | other; `recurring` and `enabled` flags. Audited, HR-only guard at router level, `no-store`. Add the routes to the employee-403 walk in `auth.test.js`.
- **Done when:** HR can create, edit, disable and delete items per employee; bad input is rejected; a no-op PATCH writes no audit row; an employee gets 403

### 4.8b One-time consumption rules and engine hookup
- [x] Status (all 8 subtasks written; DB tests unrun)
- **Read:** 4.8a notes in `project status.md`; `backend/src/services/payrollEngine.js`; the `applied_period_id` comment in `004_payroll.sql`
- **Open:** `backend/src/services/deductions.js` (new), `backend/src/routes/deductions.js` (add rules), `backend/tests/deductions.test.js` (new)
- **Build:** `loadDeductions(db, employeeId, {lock})` returns the exact `deductions` shape `computeEntry` reads (enabled items; recurring always; one-time only while `applied_period_id` is null). `consumeOneTimeDeductions(db, periodId, ids)` sets `applied_period_id` (4.11 and 4.15 call both inside the generation transaction). PATCH/DELETE on an already-consumed one-time item is refused with 409 so history stays intact.
- **Done when:** One-time item applies to one period only; recurring items apply to every period; deleting a draft period frees its one-time items again
- **Subtasks** (the task's Status box stays open until all 8 are ticked):
  - [x] 4.8b-1 `services/deductions.js` (new, pure): `toDeduction` (row -> API shape, moved from the route) and `toEngineDeduction` (-> `{kind, label, amountMinor, sourceId}`); pure tests in `tests/deductionsService.test.js`
  - [x] 4.8b-2 `loadDeductions(db, employeeId, {lock})`: enabled items, recurring always, one-time only while `applied_period_id` is null, ordered by id, `FOR UPDATE` when `lock` (3 pure tests with a fake db client; real-DB coverage is 4.8b-6)
  - [x] 4.8b-3 `consumeOneTimeDeductions(db, periodId, ids)`: sets `applied_period_id` only where `NOT recurring AND applied_period_id IS NULL`; throws 409 `conflict` if the updated row count differs from `ids.length`; empty list does nothing (4 pure tests with a fake client; real-DB coverage is 4.8b-6)
  - [x] 4.8b-4 `PATCH /:id` returns 409 `conflict` for a consumed item (check inside the `FOR UPDATE` section, before the diff, so even a no-op PATCH is refused); shared pure `assertNotConsumed(item)` added to `services/deductions.js`, 1 pure test; HTTP coverage is 4.8b-7, NOT run
  - [x] 4.8b-5 `DELETE /:id` returns 409 for a consumed item (shared `assertNotConsumed` helper, called after the locked lookup, before the DELETE and the audit row); HTTP coverage is 4.8b-7, NOT run
  - [x] 4.8b-6 DB tests: load and consume (recurring every period, one-time once, disabled skipped, bad ids throw): 4 tests appended to `tests/deductions.test.js` (incl. a two-connection lock test), **written, NOT run (no Postgres)**
  - [x] 4.8b-7 DB tests: PATCH/DELETE 409 on a consumed item (item unchanged, no audit row); unconsumed items still editable: 3 HTTP tests appended to `tests/deductions.test.js`, **written, NOT run (no Postgres, npm registry blocked by the egress proxy)**
  - [x] 4.8b-8 DB test: deleting a draft period frees its items (load and edit work again); an item consumed by an approved period stays consumed: 1 test appended to `tests/deductions.test.js`, **written, NOT run**


## Day 15: Settings UI and profiles

### 4.9 Payroll Settings page, four tabs
- [x] Status (split into 8 subtasks; all done)
- **Read:** references/spec-digest.md §12, references/ui-notes.md
- **Open:** `frontend/src/pages/PayrollSettings.jsx`
- **Done when:** All four sections editable
- **Subtasks** (page lives at `/hr/settings/payroll`? decided in 4.9-3; Other Deductions needs an employee picker because items are per employee):
  - [x] 4.9-1 `frontend/src/api/money.js` (parseMoney/formatMoney/parseRate, same rules as the backend copy) and `pages/bracketView.js` (pure: bracket rows as text <-> API, add/remove/edit, table + row validation, server error mapping, tax preview); 8 tests in `tests/bracketView.test.js` **pass**
  - [x] 4.9-2 `pages/payrollSettingsView.js` (pure): pension/base form (`calcForm`, `validateCalcForm`, changed-only `buildCalcPatch`, `calcChanged`, base option labels, tax base and pension base lists kept separate), other tax form (`validateOtherTax` with the server's `bases` list, create/patch builders, `otherTaxLine`), deduction item form (four kinds only, amount > 0, create/patch builders, `isConsumed`, `deductionStatus`, `serverDeductionErrors` amountMinor -> amount); 7 tests in `tests/payrollSettingsView.test.js` **pass**, frontend suite 105 pass
  - [x] 4.9-3 `PayrollSettings.jsx` shell at **`/hr/settings/payroll`** (decided: under Settings, so the sidebar's Payroll item stays free for the salary sheet 4.16; the Settings page links to it and the Settings nav item stays active), ARIA tabs (arrow/Home/End keys, active tab in `?tab=`, unknown value = Income Tax), `payrollResource.jsx` (`useResource(path)` + `ResourceState` loading/error/retry, used by tabs 4.9-4..7), temporary tab bodies that already load each tab's endpoint, `.tabs` CSS; 2 tests added (frontend 107 pass); **not built/rendered (no Vite), JSX syntax-checked with tsc only**
  - [x] 4.9-4 Income Tax tab: `pages/IncomeTaxTab.jsx` (editable bracket table, add/remove/discard, inline + whole-table errors, server 400 mapped to cells, save via PUT; tax-base select saved via PATCH `/calculation`; preview of the saved table via new pure `previewFor`); 1 test added (frontend 108 pass); **not built/rendered (no Vite), JSX syntax-checked with tsc only**
  - [x] 4.9-5 Pension tab: `pages/PensionTab.jsx` (employee/company rates, pensionable base; PATCH with changed keys only, inline + server errors, discard); **not built/rendered, tsc syntax check only**
  - [x] 4.9-6 Other Taxes tab: `pages/OtherTaxesTab.jsx` (list, add/edit dialog, Pause/Resume switch, delete with confirm); **not built/rendered, tsc syntax check only**
  - [x] 4.9-7 Other Deductions tab: `pages/DeductionsTab.jsx` (search + employee picker kept in `?employee=`, items table with Pause/Resume/Edit/Delete, add/edit dialog, used items shown as history with no actions, 409 handled with a toast and reload); 4 pure helpers + 1 test added (frontend 109 pass); shell `PayrollSettings.jsx` now has no temporary body
  - [x] 4.9-8 CSS final pass: only `.picker` was missing (added, stacks under 700px); **`npx vite build` now succeeds (1702 modules)**, so the 4.9-4..7 tabs compile; they have still not been looked at in a browser

### 4.10 Salary profile API + edit form
- [x] Status — API and Employees Salary dialog implemented; frontend 111 pass, build succeeds; backend 193 pass, 250 skip, 1 todo. Profile DB tests written but unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §11
- **Open:** `backend/src/routes/salaryProfiles.js`
- **Done when:** Basic/allowance saved per employee

### 4.11 Payroll period create + generate draft
- [x] Status — API implemented; 4 new service tests pass; 5 integration tests written, unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §18
- **Open:** `backend/src/routes/payroll.js`
- **Done when:** Draft created for active employees


## Day 16: Workflow

### 4.12 Draft entry edit with server recalculation
- [x] Status — draft-only basic/allowance PATCH recalculates every derived column and tax breakdown atomically; 5 service tests pass; 4 DB tests written, unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §17, §18
- **Open:** `backend/src/routes/payroll.js`
- **Done when:** Edit recomputes all derived columns

### 4.13 Approve: immutable snapshot, block recalc
- [x] Status — approval API validates reviewed totals and saves full immutable configuration/entry snapshot; four service tests pass; four new DB integration tests written, unrun (PostgreSQL unavailable).
- **Read:** references/spec-digest.md §18
- **Open:** `backend/src/services/payrollWorkflow.js`
- **Done when:** Approved entry cannot be recalculated

### 4.14 Mark paid with date; audit all transitions
- [x] Status — approved-only payment recording with validated date, actor and transactional audit; three service tests pass, four new DB tests written but unrun (PostgreSQL unavailable).
- **Read:** references/spec-digest.md §18
- **Open:** `backend/src/services/payrollWorkflow.js`
- **Done when:** Audit rows for approve and paid

### 4.15 Unpaid-leave/absence deduction applied exactly once
- [x] Status — working-day/basic-salary attendance deductions, opt-in policy API/UI, replacement during recalculation and stale-approval checks. Backend 215 pass, frontend 111 pass, build passes; DB integration tests unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §17
- **Open:** `backend/src/services/payrollWorkflow.js`
- **Done when:** Re-generating does not double deduct


## Day 17: Salary sheet UI

### 4.16 Nine-column spreadsheet table
- [x] Status — real /hr/payroll salary sheet with nine columns, right-aligned money, horizontal scroll and server-backed draft edits; frontend 114 tests pass and build passes. Browser QA blocked: Chromium absent, download failed.
- **Read:** references/spec-digest.md §11, references/ui-notes.md
- **Open:** `frontend/src/pages/Payroll.jsx`
- **Done when:** Exact column order; right-aligned; scrolls horizontally

### 4.17 Row detail panel (deduction breakdown, employer cost)
- [x] Status — employee-name button opens stored entry/tax/deduction/employer-cost detail dialog; backend 217 pass, frontend 116 pass, build passes; browser checks passed with mocked API. New DB test unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §16, §17
- **Open:** `frontend/src/pages/Payroll.jsx`
- **Done when:** Breakdown matches totals

### 4.18 Month selector and Draft/Approved/Paid buttons
- [x] Status — month selection, generate/approve/pay dialogs, status-dependent actions and conflict reload. Frontend 119 pass, backend 217 pass, build/browser checks pass; new month-filter DB test unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §18
- **Open:** `frontend/src/pages/Payroll.jsx`
- **Done when:** Buttons reflect status

### 4.19 CSV export
- [x] Status — full-period UTF-8 CSV matches nine-column salary sheet; protected endpoint and download button; backend 220 pass, frontend 121 pass, build and mocked browser download/retry checks pass. DB integration tests unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §18
- **Open:** `backend/src/routes/payroll.js`
- **Done when:** CSV matches sheet


## Day 18: Payslips and dashboard

### 4.20 Payslip API (own approved only) and printable page
- [x] Status — employee-owned released-only payslip list/detail and printable portal page; backend 223 pass, frontend 121 pass, build and browser/print checks pass. DB integration unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §18, §3
- **Open:** `backend/src/routes/payslips.js, frontend/src/pages/portal/Payslips.jsx`
- **Done when:** Employee cannot fetch others' payslips

### 4.21 Dashboard stats API and page
- [x] Status — HR dashboard with all seven stats, bounded recent attendance/pending leave and manual refresh; backend 225 pass, frontend 121 pass, build and mocked browser checks pass; DB tests unrun (no PostgreSQL).
- **Read:** references/spec-digest.md §19, references/ui-notes.md
- **Open:** `backend/src/routes/dashboard.js, frontend/src/pages/Dashboard.jsx`
- **Done when:** All 7 stats + recent lists load

### 4.22 Payroll tests: locking, snapshot, isolation
- [x] Status — required checks #1, #16 and #17 pass against the real schema in PGlite; six embedded SQL/HTTP tests plus a 76-test no-skip payroll suite. Full backend 231 pass / 277 external-DB skips / zero failures. Native multi-connection races still require PostgreSQL server validation.
- **Read:** references/spec-digest.md §26 #1, #16-17
- **Open:** `backend/tests/payroll.test.js`
- **Done when:** Tests 16,17 pass
