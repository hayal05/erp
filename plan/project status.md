# Latest session — task 6.13 docs and LOC recount (2026-10-29)

**6.13 docs done; 6.12 skipped because it cannot run here** (it needs the whole stack and a browser, then a phone on the deployed URL). **README:** new section 6.1 (HR guide to Departments, positions and default salaries), new section 4.5 (deploying migration 005: backup first, record approved/paid payroll totals before, deploy once, same query after and `diff` must be empty, five migrations, smoke test), migration lists updated to five, and the status section says plainly that 6.4 to 6.11 are unrun and 6.12 is not done. **LOC (count-loc.py, not cloc):** 16,145 total = 7,978 production + 8,167 tests; Phase 6 added +782 production and +1,020 tests (about 2.6x its ~700 estimate); written up in `plan/loc-budget.md` and `loc-report.md`; the ceiling is still exceeded when tests count and the owner decision from 5.8 is still open. No application code changed this session.

**Still yours (needs a real environment):** (1) run the backend suite with `TEST_DATABASE_URL=...` (expected 576), `npm --prefix frontend test` (153) and `npm --prefix frontend run build`; (2) click through `/hr/departments`, a department page and the employee form (checklists in the 6.8, 6.9 and 6.10 entries); (3) tick 6.4 to 6.11; (4) 6.12 whole-flow check, then on the deployed URL from a phone; (5) real `cloc` if you want the official figure; (6) the deploy steps in README 4.5. Phase 5.9 (end-to-end device check) is still open and should come before deploying Phase 6.

Next: nothing left to build in Phase 6 that can be done without a running stack. When you re-upload after the verification run, send the failures (if any) and the next session fixes them; otherwise the next step is 6.12, then 5.9.

---

# Latest session — task 6.11 frontend tests reviewed and extended (2026-10-29)

**6.11 done in code.** Reviewed the frontend tests written in 6.7 to 6.10 against the done-when and closed three gaps: the employee dialog's server-error mapping is now the pure, tested `employeeSaveError` (the dialog calls it; behavior unchanged); two money-conversion tests in `positionForm.test.js` (exact minor units, round trip, ceiling, readable errors); and a drift guard in `employeeForm.test.js` that fails if a key the browser sends is missing from the server schemas. Mutation-checked (three deliberate breakages each failed the intended tests). Frontend **153 pass / 0 fail**. All 121 original tests pass except two changed on purpose with stated reasons (`hrNav` pinned list in 6.7, `employeeForm` patch payload in 6.10). The Phase 6 test map in `references/required-tests.md` lists the frontend files. No backend, migration or CSS change.

**Not verified:** build and browser rendering (no installable packages here); `EmployeeDialog.jsx` was syntax-checked after the small refactor. **Verification debt, now 6.4 to 6.11:** `TEST_DATABASE_URL=... npm --prefix backend test` (expected 576), `npm --prefix frontend test` (153), `npm --prefix frontend run build`, the click-through checklists in the 6.8, 6.9 and 6.10 entries, then tick 6.4 to 6.11 in `schedule.md` and the phase file.

Next: 6.12 whole-flow check. **This cannot be done from the build sandbox**: it needs the full stack running (PostgreSQL, built frontend, a browser) and then the deployed Render URL on a phone, so it needs your machine or a session with working `npm ci`. Then 6.13 (README, LOC recount, Neon backup note), which can be written without the stack. Phase 5.9 is still open.

---

# Latest session — task 6.10 code written (2026-10-29)

**6.10 done in code:** the employee dialog now has Department and **Position** (instead of the free-text job title). New employee: choosing a position shows a read-only salary preview and sends only `positionId`. Existing employee: changing the position shows **Current salary** beside **New position salary** with the **"Apply new position salary"** checkbox (checked by default) and sends `positionId` plus `applyPositionSalary`; clearing sends `positionId: null`; changing department empties the position (switching back restores it). Files: `EmployeeDialog.jsx`, new `PositionSalaryPreview.jsx`, `employeeForm.js`, `positionForm.js`, `styles.css`, tests in `employeeForm.test.js`. Frontend tests **147 pass** (139 + 8). One existing test assertion was changed on purpose (`jobTitle` is no longer patched; the position owns it), stated in the phase file. No backend change.

**Decisions to confirm (details in the 6.10 entry):** the legacy free-text title can no longer be edited or cleared here; no "reset to position salary" button for an unchanged position (the server can do it); the form says so when old and new salary are identical.

**Not verified:** build and browser rendering (no installable packages here). **Verification debt, now 6.4 to 6.10:** `TEST_DATABASE_URL=... npm --prefix backend test` (expected 576), `npm --prefix frontend test` (147), `npm --prefix frontend run build`, click-through checklists in the 6.8, 6.9 and 6.10 entries, then tick 6.4 to 6.10.

Next: 6.11 frontend tests (most of them already exist from 6.8 to 6.10: `departmentView.test.js`, `positionForm.test.js`, `employeeForm.test.js`, `hrNav.test.js`; 6.11 is a review for gaps against its done-when, then ticks), then 6.12 the whole-flow check, which needs a running stack. Phase 5.9 is still open.

---

# Latest session — task 6.9 code written (2026-10-29)

**6.9 done in code:** the department detail page exists. New files in `frontend/src/pages/`: `DepartmentDetail.jsx` (header with counts, search, Positions and salary table, Add / Edit / Delete, pager, states), `PositionDialog.jsx` (add and edit one position), `positionForm.js` (pure: validation, full-body builder reusing the salary-profile money rules, change detection, server-field mapping, row formatting, exact monthly total, delete and edit notices) and `tests/positionForm.test.js` (10 tests); `departmentView.js` gained `departmentIdFromParam` and `App.jsx` routes `/hr/departments/:id` to the page. Frontend tests **139 pass** (129 + 10). No backend, migration or CSS change; it uses the 6.3 positions API and the 6.4 department detail as they are.

**Behavior worth knowing:** the page says in plain words that editing a position never changes people already on it, and the dialog warns that renaming updates their job title (6.3 behavior). Delete of a held position is blocked with an explanation (server rule `in_use`). The basic-salary field starts empty on purpose.

**Not verified:** `npm --prefix frontend run build` and any browser rendering (no installable packages here); JSX syntax-checked with `tsc` only. **Verification debt, now 6.4 to 6.9:** `TEST_DATABASE_URL=... npm --prefix backend test` (expected 576), `npm --prefix frontend test` (139), `npm --prefix frontend run build`, then click through `/hr/departments` and a department page against the live API (checklists in the 6.8 and 6.9 entries); then tick 6.4 to 6.9 in `schedule.md` and the phase file.

Next: 6.10 employee form: Department, Position, read-only salary preview, and the "Apply new position salary" checkbox on a position change (`EmployeeDialog.jsx`, `employeeForm.js`, `Employees.jsx`; sends `positionId` and `applyPositionSalary` as built in 6.5). Phase 5.9 is still open.

---

# Latest session — task 6.8 code written (2026-10-29)

**6.8 done in code:** `/hr/departments` is now a real page. New files: `frontend/src/pages/Departments.jsx` (search, table of departments with Positions and Employees counts, Add department, Rename, Delete, pager, loading/error/empty states), `DepartmentDialog.jsx` (add and rename in one dialog), `departmentView.js` (pure: validation, trimmed body, change detection, plural labels, delete explanation, error mapping) and `tests/departmentView.test.js` (7 tests). `App.jsx` swaps the placeholder for the page; the department detail route stays a placeholder for 6.9. Frontend tests **129 pass** (122 + 7). No backend, migration or CSS change; it uses the 6.4 API as it is (list with `positionCount`, create, patch, delete).

**Behavior worth knowing:** delete is explained before it is tried (positions block first, then employees, matching the server's order); when blocked the dialog offers only Close; if the server refuses anyway its message appears inside the dialog and the list reloads. A rename to the same name says "Nothing was changed." Duplicate names show under the field (409 from the server).

**Not verified:** `npm --prefix frontend run build` and any browser rendering (this sandbox cannot install packages); the three JSX files and `App.jsx` were only syntax-checked with `tsc`. **Verification debt, now 6.4 to 6.8:** with PostgreSQL and packages available, run `TEST_DATABASE_URL=... npm --prefix backend test` (expected 576 pass), `npm --prefix frontend test` (129) and `npm --prefix frontend run build`; open `/hr/departments` against the live API (checklist in the 6.8 entry of the phase file); then tick 6.4 to 6.8 in `schedule.md` and the phase file.

Next: 6.9 department detail with the Positions and salary table (`pages/DepartmentDetail.jsx`, `PositionDialog.jsx`, `positionForm.js`; uses `GET /api/departments/:id` and the 6.3 positions API). Phase 5.9 is still open.

---

# Latest session — task 6.7 code written (2026-10-29)

**6.7 done in code:** the HR sidebar has **Departments** right after Employees (8 items), routes `/hr/departments` and `/hr/departments/:id` exist as placeholders, icon added, spec §4 digest updated. Frontend tests **122 pass** (121 + 1 new; the pinned nav list was updated on purpose). A locked tablet is still redirected to `/hr/qr` from both new paths (tested in `hrNav.test.js`); no server change.

**Not verified:** `npm --prefix frontend run build` (this sandbox cannot install packages), so `App.jsx` and `HrLayout.jsx` edits have not been compiled; they are small (one import, one icon entry, two routes).

**Verification debt, now 6.4 to 6.7:** with PostgreSQL and packages available, run `TEST_DATABASE_URL=... npm --prefix backend test` (expected 576 pass), `npm --prefix frontend test` (122) and `npm --prefix frontend run build`; then tick 6.4 to 6.7 in `schedule.md` and the phase file. Note: `tests/positions.test.js` (6.6) was already in the project folder when this session started and was reviewed against the 6.4/6.5 behavior, not rewritten.

Next: 6.8 Departments page with Add department (`pages/Departments.jsx`, `DepartmentDialog.jsx`, `departmentView.js`). Phase 5.9 is still open.

---

# Latest session — task 6.6 tests written, nothing in 6.4-6.6 verified yet (2026-10-29)

**6.6 written:** `backend/tests/positions.test.js`, 15 database cases covering the cross-feature rules listed in the 6.6 entry of `tasks/phase-6-departments-positions.md` (package copy on create, apply vs decline on position change, personal manual edits, position edits never reaching employees, department-change rules, 422 mismatch, job title ownership, rollback via a temporary failing trigger, approved payroll byte-identical, next draft uses the new salary). Phase 6 test map added to `references/required-tests.md`. No product code changed this session.

**Verification debt, in one place:** 6.4, 6.5 and 6.6 are all unverified because this sandbox has no PostgreSQL and cannot install packages (tried `npm ci` and `npm ci --offline`). Run `TEST_DATABASE_URL=... npm --prefix backend test` once; expected 576 pass (553 + 3 + 5 + 15). If something fails, check first whether it is a test slip (the file has never executed), then whether it is real. When green, tick 6.4, 6.5 and 6.6 in `schedule.md` and the phase file. Frontend suite is untouched (121).

Next: 6.7 sidebar item and routes (frontend: `hrNav.js`, `App.jsx`, `hrNav.test.js`, spec §4 to 8 items). Phase 5.9 is still open.

---

# Latest session — task 6.5 code written, verification pending (2026-10-29)

**6.5 implemented; not yet verified against a database** (same sandbox limits as 6.4: no PostgreSQL, `npm ci` cannot download). Employee create now accepts `positionId`: the position's name becomes the job title and its salary package becomes the new employee's salary profile in the same transaction. Employee update accepts `positionId` and `applyPositionSalary`: the salary is replaced only when the flag is true; clearing a position keeps the salary; changing department without a position in the new one clears the position in the same UPDATE. Employee responses carry `positionId` and `positionName`. Payroll code, migrations and the frontend are untouched. Decisions made while building are listed in the 6.5 entry of `tasks/phase-6-departments-positions.md` (422 vs 400, job title owned by the position, apply-without-position is 422, re-apply to reset).

**Tests:** 5 new pure tests in `tests/positionAssign.test.js` (schema, `loadAssignablePosition` with a fake db, 422 backstops); with the existing pure suites 28/28 pass. The database cases (package copied on create, apply vs decline on change, rollback, approved payroll unchanged, employee role denied) are task 6.6.

**Outstanding verification, in order:** run `TEST_DATABASE_URL=... npm --prefix backend test` once; expect 556 from 6.4 plus the 5 new pure tests; then tick 6.4 and 6.5. Changes to existing tests: none needed for 6.5 (employee shapes are only extended).

Next: 6.6 backend tests (`tests/positions.test.js`), which is also where 6.4/6.5 get exercised on a real database. Phase 5.9 is still open.

---

# Latest session — task 6.4 code written, verification pending (2026-10-29)

**6.4 implemented in `backend/src/routes/departments.js`; not yet verified.** List, detail and all write responses of departments now include `positionCount`. A detail route `GET /api/departments/:id` was added (it did not exist; the 6.9 department page needs it). Deleting a department with positions is refused with 409 `in_use` and its own message, checked before the employee foreign key so the message names the real blocker. The 6.3 carry-over about the wrong "still has employees" wording is resolved.

**Tests written:** 3 new in `tests/orgstructure.test.js`, the HR-only walk extended to the new route, and one existing shape assertion updated on purpose (`positionCount: 0`).

**NOT run:** this sandbox has no PostgreSQL and `npm ci` cannot download packages (network off), so only `node --check` was possible. **First thing next session:** `TEST_DATABASE_URL=... npm --prefix backend test` (or at least `orgstructure.test.js` and `positionsApi.test.js`), then tick 6.4 in `schedule.md` and `phase-6`. Expected: 553 + 3 = 556 pass.

Next: 6.5 employee create and update apply the position package (carry-over from 6.1: moving an employee to another department must clear or replace the position in the same statement). Phase 5.9 is still open.

---

# Latest session — task 6.3 completed (2026-10-29)

**6.3 done.** Positions API in `backend/src/routes/positions.js`: list and create under a department (`/api/departments/:id/positions`), edit and delete by id (`/api/positions/:id`). HR only (anonymous 401, employee 403, locked tablet 423), audited (`position.create/update/delete`), duplicate names 409 per department ignoring case, edit takes the full body and cannot move a position to another department, an unchanged edit writes and audits nothing, delete is refused with 409 `in_use` while any employee holds the position. Creating locks the department row so a concurrent department delete cannot leave an orphan.

**One decision added while building:** renaming a position updates the `job_title` of the employees on it (they got the name copied at assignment, so it would otherwise go stale on payslips and exports). Their salary profiles are not touched; the test checks the whole row including `updated_at`. The audit row records how many titles moved.

**Verified (native PostgreSQL 16):** 8 new API tests in `positionsApi.test.js`; full backend suite **553 pass / 0 fail / 0 skipped** (was 545); production smoke and root build pass. Frontend untouched.

**Known and deliberate:** the department delete handler still words every foreign-key refusal as "still has employees"; fixing that message and adding `positionCount` is task 6.4, next.

Next: 6.4 department API additions. 10 Phase 6 tasks remain: 6.4-6.13. Phase 5.9 is still open.

---

# Latest session — task 6.2 completed (2026-10-29)

**6.2 done.** One function now writes salary profiles: `saveSalaryProfile` in `backend/src/services/salaryProfiles.js` (employee row lock, 404 for a missing employee, unchanged saves write and audit nothing, create/update audit with an optional `source` marker). The Salary dialog's PUT route calls it, and tasks 6.5 (employee create / position change) will call the same function, so the two paths cannot drift apart. The five salary fields and their limits live once in `SALARY_SCHEMA`; salary profiles and the new `parsePosition` (in `backend/src/services/positions.js`) both use it. Position names are limited to the job-title length through one shared constant (`JOB_TITLE_MAX`), because the server writes the position name into `employees.job_title`.

**Behavior unchanged:** the existing salary-profile route and tests pass without modification; the route lost 22 lines and gained 5. No migration, no payroll code touched.

**Verified (native PostgreSQL 16):** 13 new tests (7 unit, 6 database); full backend suite **545 pass / 0 fail / 0 skipped** (was 532); root build passes. Frontend untouched (121 pass at 6.1).

Next: 6.3 positions API (`GET/POST /api/departments/:id/positions`, `PATCH/DELETE /api/positions/:id`). 11 Phase 6 tasks remain: 6.3-6.13. Phase 5.9 is still open.

---

# Latest session — task 6.1 completed (2026-10-29)

**6.1 done.** `database/migrations/005_positions.sql` adds the `positions` table (department, name, basic, one allowance with taxable/pensionable flags, pension flag; same limits as `salary_profiles`; unique name per department ignoring case; RESTRICT to departments) and a nullable `employees.position_id`. Extra safety beyond the task text: a composite foreign key `(department_id, position_id)` makes the database refuse a position from another department, with a CHECK closing the "position but no department" gap. Payroll tables are not touched. `backend/tests/helpers.js` cleanup list now includes `positions`.

**Verified on a native PostgreSQL 16 server (apt, port 5433):** 7 new tests in `schema.test.js` (defaults, name uniqueness and blanks, money limits, department delete guard, same-department rule, position-in-use delete guard, payroll untouched); migration applied to a database already at 004 with real employees, a department and a salary profile: existing data unchanged, both employees have no position, second run applies nothing, 5 migrations recorded; full backend suite **532 pass / 0 fail / 0 skipped** (was 517 plus 8 single-service tests plus these 7); frontend 121 pass. Not verified: Neon itself (take a Neon branch or backup before the first deploy that carries 005).

**Carry-over notes for later tasks** (also in the 6.1 entry): the department delete handler currently reports every foreign-key refusal as "still has employees", so 6.4 must check positions first; moving an employee to another department while keeping the old position is refused by the database, so 6.5 must clear or replace the position in the same update.

Next: 6.2 (position validation and one shared function that writes salary profiles). 12 Phase 6 tasks remain: 6.2-6.13. Phase 5.9 is still open.

---

# Latest session — Phase 6 planned and scope confirmed (2026-10-29)

**Owner request:** a dedicated **Departments** sidebar item with an **Add department** button; inside a department, a **positions and salary table**; when a department and position are chosen for a new employee, the salary is taken from the position by default and stays editable per employee afterwards.

**Owner answers:** (1) no automatic move of existing employees onto positions, the owner does it manually; (2) when an employee's position changes, the new position's salary applies by default but remains editable after saving for exceptional cases; (3) **one allowance** (several were considered, then dropped, so payroll code is untouched).

**Done this session (planning only, no application code changed beyond the earlier single-service merge):** added `tasks/phase-6-departments-positions.md` (13 tasks, 6.1-6.13, Days 22-24, 10 design decisions, risks), Phase 6 block in `schedule.md`, ~700 LOC estimate in `loc-budget.md`, plan README pointer.

**Findings that shaped the plan:** departments have an API but no page; employees only have a free-text `job_title`; salary profiles are not created on employee creation; the sidebar is pinned to 7 items by `hrNav.test.js` and spec §4, so this change deliberately makes it 8.

**Key decisions:** `positions` carries the same five salary columns as `salary_profiles`, so a package copies straight across; creating an employee copies the position's salary in the same transaction; on a position change the form shows current versus new salary with an "Apply new position salary" checkbox checked by default, audited before and after; editing a position never changes existing employees; one shared service function writes salary profiles (used by the salary route and the employee routes).

**Confirmed by owner:** editing a position's salary leaves existing employees unchanged, and a manual salary edit is an exception for that one person only. No open questions remain for Phase 6.

Not started: 6.1-6.13. Phase 5.9 (end-to-end device check on the deployed single service) is still open and should be done before Phase 6 is built. Take a Neon backup/branch before deploying migration 005.

---

# Latest session — task 5.8 written, ceiling exceeded (2026-10-28)

`loc-report.md` added at the repo root. **Result: 14,343 code lines (by language JS 10,922, JSX 2,587, SQL 375, CSS 284, YAML/JSON/HTML 175; by area production 7,196 incl. 184 config, tests 7,147) = 59% over the 9,000 ceiling when counted the way loc-budget.md defines it (tests included). Tests are 7,147 of that; production code alone is 7,196 (3% over the 7,000 target, within the ceiling).** The 5.8 done-when ("within 9,000") is therefore NOT met and is reported as such, not redefined. cloc is not installable here (no network), so the count comes from the new `plan/references/count-loc.py` (cloc's blank/comment/code definitions); run real cloc to confirm. Per-phase actuals cannot be reconstructed (no version control, only totals logged). Three options for the owner are in the report; recommended: restate the budget as production-code-only with tests tracked separately. No application code changed.

Next: 5.9 end-to-end check (lock, scan, selfie, attendance, leave, payroll, payslip) on a real tablet and phone with real Cloudinary, deployed or HTTPS-tunnelled. This cannot be done from the build environment; it needs the owner's devices. 1 task remains: 5.9.

---

# Latest session — task 5.7 completed (2026-10-28)

**5.7 done.** Root README now has section 7 "Operations guide" (status moved to section 8): backups (Neon history plus own `pg_dump --format=custom`, restore into a NEW database, three post-restore checks, restore drill, dumps are sensitive, photos are not in the DB dump), selfie retention/deletion (no period in the spec, so the operator chooses; date-cutoff and per-employee procedures: list IDs with psql, delete via the app's idempotent `photos.delete`, only then null the columns and write an `attendance.photo_purge` audit row; orphan reconciliation by comparing the logged 16-hex SHA-256 reference), manual attendance fallback (paper sheet, HR Attendance > Correct with required reason; limits: no row on non-working days/holidays or for today before shift end, 62-day gap-fill window, stale draft payroll must be recalculated, approved/paid payroll never changes), and the same-day-shift limit (overnight shifts unsupported; lifting it is a design change).

Checked against the code, not guessed: orphan hash recipe (shell `sha256sum | cut -c1-16` equals the code's output), migrations table `schema_migrations(filename, checksum)`, `FILL_BACK_DAYS = 62`, photo columns are nullable with no CHECKs, the purge snippet's imports resolve and fail safe with no Cloudinary config. **Not verified:** `pg_dump`/`pg_restore` against Neon (no PostgreSQL client tools or network in this sandbox) and the purge against a real Cloudinary account. Both are flagged in the README. No application code changed.

Possible follow-up (not done, outside 5.7): a `backend/scripts/purge-photos.js` so retention is one command instead of three steps; correction screen cannot create rows for non-working days.

Next: 5.8 real LOC report with cloc (`loc-report.md`; target 7,000, ceiling 9,000; the status file's last measured count was 7,678 after Phase 3, so expect to be over the ceiling and report the trade-offs honestly). Then 5.9 end-to-end check on real tablet + phone. 2 tasks remain: 5.8 and 5.9.

---

# Latest session — tasks 5.6 completed and 5.2 closed (2026-10-28)

**5.2 closed.** A native PostgreSQL 16 server (apt, postgres user, port 5433) ran the whole backend suite serially: first run 517 tests, 515 pass, 2 fail; both were test-only problems and were fixed (late-minutes expectation now at whole-second precision as the classifier works; payrollSettings.test.js restores the seeded payroll_settings row in its `after` hook so schema.test.js sees the spec defaults). Rerun: **517 pass / 0 fail / 0 skipped**, which includes the 12 multi-connection cases that were blocking sign-off. Frontend 121 pass. Synthetic secrets not present in the native test output or API log. No application code changed. Evidence in plan/references/test-sweep.md.

**5.6 done.** Root `README.md`: local setup, tests, env-var table, Render + Neon + Cloudinary deployment, one-off HR seed from a developer machine (Render free has no shell; shell env overrides .env), cookie two-host caveat, UptimeRobot (HTTP monitor on /health, 5 min), project layout, honest status. Followed on a clean extract: npm ci, migrate (4 applied), seed, API boot, /health, HR login, Vite on 5173, root build, seeding a second database via env override. Not verified: a real deployment, UptimeRobot itself.

Open items still real: live Cloudinary privacy (smoke script), cookies on deployed hosts, tablet/phone camera flow (5.9), Neon pooler/TLS and Node 24 (not exercised here).

Next: 5.7 backup guide, photo retention/deletion, manual attendance fallback, same-day-shift note (README docs section; the README already points to it). 3 tasks remain: 5.7-5.9.

---

# Latest session — task 5.5 completed (2026-10-28)

Verified the Render start command against a **native PostgreSQL 16 server** (installed via apt, run as the postgres user on port 5433, which the previous environment note said was impossible). Migrations 001-004 apply on an empty database and a second run is a no-op. Two migrators started simultaneously on an empty database serialize on the advisory lock: one applies, the other reports up to date, both exit 0, four rows recorded. A checksum-mismatched applied migration makes the migrator exit 1 and the `&&` prevents the API from starting; output contains no SQL or credentials.

Memory of the real Node process (VmRSS/VmHWM): ~71 MB right after boot, ~68 MB idle, 111 MB after 30 s at 20 concurrent clients (10,520 requests, all 200), peak 112 MB after 200 bcrypt logins and 20 s at 60 clients. No growth between load phases. Limit is 512 MB. An earlier attempt measured the wrapper shell PID by mistake and was discarded.

Not covered: near-empty dataset, no Cloudinary/selfie upload path, local Postgres rather than Neon, Node 22 rather than 24, not a Render instance. Evidence and caveats are in plan/references/startup-memory.md. No application code changed.

Opportunity noted: a native PostgreSQL server now runs in this environment, so the 12 native multi-connection cases still blocking 5.2 can probably be run next (apt-get update, apt-get install postgresql, start as postgres user, set TEST_DATABASE_URL to a database whose name contains "test").

Next: 5.6 README. 5 tasks remain: pending native multi-connection sign-off in 5.2 plus 5.6-5.9. Older summaries below are historical.

---

# Latest session — task 5.4 completed (2026-10-28)

Added render.yaml defining a Node 24/free API web service and a static frontend. Both retain repo-root access so backend migrations can see database/migrations. Backend build installs only runtime dependencies and validates source; static build includes Vite dev dependencies and publishes frontend/dist with SPA rewrite/security/cache headers. API uses /health, explicit 0.0.0.0 binding and Render's PORT. Commit auto-deploy is off. No services were created or deployed.

Runtime DATABASE_URL is the pooled Neon URL. MIGRATION_DATABASE_URL is a separate user-supplied direct URL to the same database because the migration runner uses session advisory locking. The start command runs migrations with the direct URL before starting the API with its original runtime URL. Other credentials use sync:false; SESSION_SECRET uses generateValue. FRONTEND_URL must be the actual static HTTPS origin; the frontend references the API public RENDER_EXTERNAL_URL. No private-network hostname or guessed public domain is used.

Final .env.example covers local/runtime/seed/photo/test/deployment settings without actual credentials. The obsolete unused QR_TOKEN_TTL_SECONDS override was removed. .node-version pins major 24. Vite now reads root envDir and exposes only VITE_ values; shared NODE_ENV remains unset locally by default to avoid contaminating production frontend builds. Git ignores private .env variants while retaining the template. Cookie guidance distinguishes cross-site None/Secure from same-site custom-domain Lax and retains real-browser login verification as pending.

Verification: Render published JSON Schema and project-specific invariants pass. Application environment-key coverage checked. A root-env production bundle contains its public API origin and none of the injected private session/database/Cloudinary canaries. An isolated npm ci --omit=dev backend install plus build and production smoke passes without dev dependencies. Standard backend 240 pass / 277 native skips; frontend 121 pass; root build passes. Details, setup matrix and primary-source links are in plan/references/render-configuration.md.

Next: 5.5 startup migration and memory check (<512 MB). 6 tasks remain: pending native multi-connection sign-off in 5.2 plus 5.5–5.9. Older summaries below are historical.

---

# Latest session — task 5.3 completed (2026-10-28)

Root npm run build now validates the backend and builds the frontend. Backend/scripts/build.mjs checks every one of the 57 native ES-module source files without requiring runtime secrets; no transpilation/dist is needed for this backend. Frontend Vite build succeeds (1,714 modules; JS 337.03 kB / 105.04 kB gzip, CSS 18.13 kB / 4.53 kB gzip).

New backend npm run check:production launches the real API in production mode with temporary generated credentials and unused local DB configuration, then checks boot, /health, CORS, anonymous HR guard, rejection of missing required configuration and absence of generated secrets in startup output. It closes the child process; no database/Cloudinary connection is used. This is not a migration or memory test (5.5).

The built frontend was served through Vite preview and passed Chromium checks with mocked APIs for dashboard metrics, links/recent lists, refresh, mobile containment, empty/retry states and employee redirects. Source package excludes generated dist/node_modules, which the build recreates. Evidence/commands are in plan/references/production-builds.md.

Task 5.2 remains OPEN only for native PostgreSQL multi-connection sign-off: local backend 240 pass, serial DB sweep 275 pass with 12 native cases explicitly excluded, frontend 121 pass. Logging fixes and database/test fixes from the prior package are included. Live provider/device checkpoints are still pending.

Next: 5.4 render.yaml and final .env.example. 7 tasks remain: pending 5.2 plus 5.4–5.9. Older summaries below are historical.

---

# Latest session — task 5.2 local sweep and logging review (2026-10-28)

Standard backend: 240 pass, 277 native DB skips, zero failures/todos. New npm run test:db-embedded executes existing database files against isolated PGlite engines with pg-compatible bigint decoding, unchanged migrations and original migration runner: 275 serial cases pass; 12 exact named native multi-connection cases are excluded, not verified. The runner fails if an excluded name is removed/renamed. Frontend 121 pass and production build succeeds.

Four failures uncovered in the broader database sweep were fixed: assigned department/shift deletion now recognizes SQLSTATE 23001 as well as 23503 and returns expected 409 in_use; a gross-constraint fixture computes net/employer cost from the effective gross to isolate the intended constraint; an immutability test checks the trigger's correct cannot-be-deleted message. All 33 targeted organization/schema cases pass. Constraints were not weakened.

Log review fixed raw exception text/stacks in request/database/CLI failures using allowlisted event/code output, removed production 500 error details, replaced raw orphan photo IDs with 16-hex SHA-256 references, and expanded audit redaction for credential/database/photo keys. New regression tests inject synthetic secret canaries and capture output; passing suite logs contain no tested canary values. Startup/seed/migration progress output was inspected. Retention guidance must reconcile hashed orphan references without restoring raw photo IDs to logs.

Evidence and commands are in plan/references/test-sweep.md. Task 5.2 stays OPEN for native multi-connection verification: this root-only environment cannot start a native PostgreSQL server as an unprivileged user. PGlite cannot establish race/row-lock/serialization behavior. No native/server/live-device passes are claimed.

Next independent implementation task: 5.3 production builds. 8 tasks remain including pending 5.2 (5.2–5.9). Older summaries below are historical.

---

# Latest session — task 5.1 completed (2026-10-28)

All 17 spec §26 requirements are mapped to exact source test-case names in plan/references/required-tests.md. Mapping generation checked that each referenced file/name exists and that requirement IDs cover 1–17 exactly. The table separates local evidence, external-server cases and live provider/device checkpoints. Existing named native cases remain intact.

Five additional SQL/HTTP cases in payrollEmbedded.test.js fill executable coverage gaps for #2–8, #10 and the API part of #11: lock gates now exercise newer payroll/dashboard/settings routes and URL tricks; repeated authenticated state reads prove lock restoration; password reauthentication and two-cookie-session isolation are verified; real token expiry/replay/check-in and the no-checkout-without-checkin database constraint run; selfie access requires HR, is uncached/audited and photo IDs are absent from employee history. Storage/signing is stubbed. The fixture now resets token/unlock/scan limiters and attendance_tokens between cases. Eleven embedded SQL/HTTP cases pass against all four unmodified migrations.

Added npm run test:required-local for the embedded cases plus QR/lock/attendance-action/Cloudinary-contract/payroll-engine and frontend redirect/navigation helper tests. Result: 74 passed with no skips/failures/todos. Full backend suite: 236 passed, 277 skipped (external PostgreSQL), zero failures/todos. Frontend suite: 121 passed, zero skipped/failures/todos. No production application code changed this task.

Requirement #9 has two named native multi-connection tests in attendanceScan.test.js but remains UNRUN here; PGlite cannot prove simultaneous-session behavior. Cloudinary contract/privacy checks pass with stubs; real configured-provider privacy and tablet/phone camera/refresh flows remain pending. No fabricated concurrency substitute or blanket claim of all 17 verified is made. Phase 5.2 still owns the full environment-backed sweep, fixes and log-secret audit; 5.9 owns device end-to-end testing.

Next: 5.2 run all tests, fix failures, check logs for secrets. 8 main tasks remain (5.2–5.9). Older summaries below are historical.

---

# Latest session — task 4.22 verified (2026-10-28)

Added dev-only @electric-sql/pglite 0.5.13 and tests/payrollEmbedded.test.js. The suite starts an isolated in-memory PostgreSQL engine with btree_gist and applies all four unmodified migrations. It adapts the application's pg pool only within this Node test worker, exercises the real Express login/session/CSRF/role/lock pipeline and real payroll SQL/constraints/triggers/transactions, and never opens an external database. Production code is unchanged.

Six runnable SQL/HTTP tests verify: (1) approved/paid recalculation and direct SQL entry/item/snapshot/status/delete protections; (2) immutable snapshot, entries, detail, own payslip and CSV after source/config changes, while next draft uses changed inputs; (3) draft payslip hiding, cross-employee guessed-ID 404s, spoofed list ownership, HR endpoint denial and tablet lock; (4) stale approval, one-time deductions across periods and rollback on audit failure; (5) replacing attendance deductions exactly once plus actual dashboard and month-filter SQL; (6) partial-generation rollback and duplicate-month rejection. Required checks #16 and #17 now PASS against a PostgreSQL engine, with #1 ownership covered end to end as well.

New npm run test:payroll groups payroll service/unit and embedded SQL/HTTP tests. Result: 76 passed, zero skips/failures/todos. Full backend npm test: 231 passed, 277 skipped (external-server suites), zero failures/todos. Frontend unchanged this task. Coverage and commands documented in plan/references/payroll-test-coverage.md.

Native PostgreSQL setup was attempted but this workspace only permits root and refuses switching user/user namespaces; no server could be started safely. PGlite is single-session and does NOT validate multi-connection races, row-lock waits, deadlocks/serialization handling, pooling or production TLS. Existing native-PostgreSQL tests for those behaviors remain skipped and must run during Phase 5 on a dedicated test server. This task does not establish deployment readiness or complete prior real-device checkpoints.

Phase 4 implementation and the targeted #16/#17 verification are complete. Next: 5.1 map all 17 required tests to files and fill gaps. 9 main tasks remain (5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.21 implemented (2026-10-28)

/hr is a real Dashboard page, backed by HR-only GET /api/dashboard with no-store, lock checks and a consistent read-only transaction. Seven metrics: total employees (all statuses), current-month payroll net total, present today, late today, absent today, on leave today, pending leave. Present includes late arrivals and incomplete records with a check-in; late is a subset. Daily attendance metrics include active employees whose start date has arrived. Missing rows are classified directly from shifts, holidays and approved leave; absence only after shift end. Existing HR-corrected attendance status is respected. Uses company timezone and database transaction time, without writing attendance or needing the attendance screen's gap fill.

Monthly payroll uses saved net salary amounts for the company-calendar current month, with status/currency/employee count. Missing payroll is null (shown as a dash with an explanation), distinct from a generated zero total. Aggregates outside safe integer money range are rejected. Recent attendance is capped at 8 rows; pending leave queue at 6, oldest first. No selfie URLs or other sensitive source data are added.

Frontend uses three primary summary cards, four secondary metrics, recent attendance and pending leave tables with useful links. Payroll link opens the correct month. Manual refresh only; loading, error/retry and empty/missing states included. Layout inspected on desktop/mobile; tables scroll within the content area. No invented chart/trend values.

Validation: backend 225 passed, 277 DB-dependent skipped, zero failures/todos; frontend 121 passed; production build passes. Two new dashboard service tests cover returned fields, company-clock binding, bounded read-only queries, null-vs-zero payroll and safe money. Two DB tests cover HR/employee/anonymous/lock access, no-store, fixed-date company-time attendance/leave/shift-end/holiday behavior, pending requests and saved payroll net total; UNRUN because PostgreSQL is unavailable. Mocked browser checks passed for all seven cards, payroll link, lists, refresh, mobile containment, missing/empty states, retry and employee redirect.

Task 4.20 employee payslips was also finished and saved in the preceding package during this session, including inspected one-page A4 sample printing.

Next: 4.22 payroll tests (locking, snapshot, isolation). 10 main tasks remain (4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.20 implemented (2026-10-28)

GET /api/payslips lists only signed-in employee entries in approved/paid periods, with pagination. GET /api/payslips/:id checks entry ID, employee user_id and released period state in one SQL ownership predicate; missing, draft and another employee's entry all return 404. requireEmployee/noStore/session middleware apply. Request-supplied employee/user IDs are ignored. Consistent read-only transactions wrap list/detail. Detail returns only the owned entry and stored items, company name, approved time and payment date; never the all-employee config_snapshot. Approved amounts/identity/breakdown stay independent of live configuration/profile changes.

Employee portal /portal/payslips has a paginated list, released status, net amount and View links. /portal/payslips/:id shows saved salary/tax/pension/deduction/employer-cost details with Print payslip and back navigation. Loading, empty, 404, error/retry states included; invalid URL IDs never fetch. Reuses salary detail rendering and exact money display. Print CSS hides navigation/buttons/toasts, uses white page background and compact A4 styling. Sample output was rendered and inspected at one A4 page; long breakdowns may continue onto more pages.

Validation: backend 223 pass, 275 skipped, zero failures, zero todos (the old salary/payslip-isolation todo is now covered by integration assertions). Frontend 121 pass; production build passes. Three new payslip service tests verify authenticated SQL scoping, released-only guards, 404 denial and absence of all-employee snapshot data. New DB integration test covers anonymous/HR denial, draft hiding, own list/detail, guessed other IDs, later config edits and paid metadata; UNRUN because PostgreSQL is unavailable. Browser mocked-API checks passed for list pagination, detail, print invocation/media, 404 clearing, retry and empty states; sample print PDF visually inspected.

Next: 4.21 dashboard stats API and page. 11 main tasks remain (4.21–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.19 implemented (2026-10-28)

HR-only GET /api/payroll/periods/:id/export.csv exports every stored salary entry, ordered by employee_id, regardless of the salary sheet's current page. It reads period and entries in a repeatable-read read-only transaction. Existing role, session-lock and no-store protections apply; missing periods return JSON 404. It exports draft, approved or paid saved amounts without recalculation or reads of source settings/profiles. Filename payroll-YYYY-MM.csv; Content-Disposition attachment; text/csv UTF-8 with BOM for Unicode/Amharic spreadsheet compatibility.

Exactly the sheet's nine columns, with employee pension (not employer pension). Monetary cells use exact two-decimal ungrouped major units, including zero and negative net. Text fields quote commas/newlines/double quotes correctly and neutralize formula-like prefixes with an apostrophe; monetary negatives remain ordinary numeric values. Rows use CRLF. Empty periods return a header-only CSV.

Payroll has Export CSV for a loaded period. It uses authenticated fetch through the existing API client (getFile blob mode), preserving server/session error handling. Busy state prevents repeat clicks. Download uses a temporary blob URL and selected period month; month/page unload aborts the request and successful URLs are revoked. Error responses are shown as toasts, never downloaded as CSV. Nothing is exported for missing/error/loading periods.

Validation: backend 220 passed, 274 skipped, 1 existing todo; frontend 121 passed; production build passes. Three new CSV service tests cover exact columns/amounts, Unicode/escaping/formula safety, all 52 fixture rows without pagination and missing periods. Two API-client tests cover authenticated blob responses and locked-session errors. Two DB integration tests cover headers/all saved rows/history, missing periods, role/lock isolation; UNRUN because PostgreSQL is unavailable. Browser tests with mocked APIs downloaded and inspected the CSV filename/content, recovered from an export failure, and reran month/generate/approve/pay/mobile checks successfully.

Next: 4.20 employee-owned released payslips API and printable page. 12 main tasks remain (4.20–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.18 implemented (2026-10-28)

Payroll has a labelled month input, saved in ?month=YYYY-MM; refresh preserves selection. Existing ?period=<id> links still work when no month is specified. Default view remains latest period (or current browser-local month if none exists). Server GET /api/payroll/periods supports optional validated exact-month filtering with filtered total; this distinguishes empty months without loading all history.

Controls follow server status: no period -> Generate draft; populated draft -> Approve payroll; approved -> Mark paid; paid -> locked paid-date text. Empty drafts cannot be approved. No workflow action while loading or on read error. Dialogs capture period/month, explain scope and require an explicit submission. Generate invokes 4.11, approval invokes 4.13, pay invokes 4.14. Payment date defaults to browser-local today, requires a real calendar date and is sent as date-only. Mark paid records an external payment and does not transfer money. Form guards prevent duplicate submissions/dismissal during a request.

Successful actions update selected month and reload authoritative period/entries. Server validation errors remain in dialog; missing-profile IDs and stale entry ID are shown when returned. 404/409 replaces the submit action with Reload payroll to prevent retrying an outdated transition without reloading. Salary edit/detail state closes on month changes and pagination resets. Approved/paid salary cells remain read-only.

Validation: frontend 119 pass (three new helper tests covering status-dependent actions, month formats and real payment dates), backend 217 pass / 272 skipped / 1 existing todo; zero failures. Production build passes. Browser checks with mocked API passed: exact month selection and empty month, generate, stale approval/reload, approval, invalid/valid payment dates, paid lock/date, refresh preserving month and mobile controls/scroll containment. A new PostgreSQL integration test covers exact-month filtering, filtered totals, missing months and invalid formats; UNRUN because PostgreSQL is unavailable. Live API end-to-end validation remains outstanding.

Next: 4.19 CSV export. 13 main tasks remain (4.19–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.17 implemented (2026-10-28)

Employee Name cells in the salary sheet are accessible buttons opening SalaryDetailDialog. The nine-column sheet stays unchanged. The dialog loads details on demand, with loading/error/retry states and abort on close. It shows basic/allowance/gross, taxable income, income tax rate and fixed deduction, pensionable base, employee pension, total employee deductions and net. Separate tables show stored other-tax name/rate/base/amount and stored flat deductions with types (including attendance deductions). Subtotals are reconciled with saved amounts; a mismatch displays a warning. Employer cost section separately shows gross + employer pension and explains that company pension does not reduce employee net. Negative net remains visible.

New HR-only GET /api/payroll/periods/:id/entries/:entryId reads entry and item lines inside a repeatable-read read-only transaction. It returns stored identity/amounts, period status/month/currency and stored breakdown lines; no live settings, salary profiles or deduction source items are consulted. Cross-period/missing IDs return 404. Existing HR/session-lock checks and no-store protect it. This preserves approved history after source/config edits.

Validation: backend 217 pass, 271 skipped, 1 existing todo; frontend 116 pass; production build passes. Two new backend service tests cover stored mappings and 404 isolation; two new frontend tests cover exact reconciliation, employer/employee pension separation, missing lines, zeros and negative net. New DB test covers matched totals, role/period/lock protection and stable approved history; UNRUN because PostgreSQL is unavailable.

Browser QA succeeded using local Chromium and mocked API data: exact nine headers, salary edit validation and exact-money payload, server-result refresh, mobile horizontal scroll without page overflow, approved/paid read-only cells, list failure/retry and empty states; opening/closing detail dialog, matching breakdown and scrolling to employer cost. Desktop/mobile screenshots were visually inspected, with no runtime page errors. This resolves the previous session's missing-browser blocker for these checks. Live API/database browser QA remains outstanding.

Next: 4.18 month selector and Draft/Approved/Paid workflow controls. 14 main tasks remain (4.18–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.16 implemented (2026-10-28)

/hr/payroll now renders Payroll.jsx instead of the placeholder. Loads the latest period by default, or a valid ?period=<id> link, then period detail and paginated entries (25/page). Invalid IDs display an error. Separate loading/error/retry/empty states; requests abort on page/period changes and stale rows clear before loading. Payroll settings link included. No period creation/selection/workflow buttons yet (task 4.18).

Exactly nine columns in spec order: Employee ID, Employee Name, Basic Salary, Allowance, Income Tax, Other Tax, Pension (employee share), Other Deductions, Net Salary. Compact bordered spreadsheet styling; money right-aligned with tabular numerals; horizontal scrolling confined to a keyboard-focusable table region; negative net displayed with minus and danger colour. No extra actions column.

Draft basic/allowance amounts are accessible edit buttons opening a labelled dialog. Money parsing is exact minor units; local validation prevents bad amounts; save calls the 4.12 PATCH endpoint and reloads authoritative values. Server totals are never calculated in the browser. Salary profiles stay unchanged. Approved/paid entries render plain read-only amounts. A 404/409 while saving closes the editor and refreshes period state; other errors stay in the dialog for correction/retry. Busy form prevents double-submit and dismissing during save.

Validation: frontend 114 tests pass (three new tests cover exact required headers, employee-pension mapping, draft-only edit eligibility, exact-money payload/validation and safe period IDs); production Vite build passes. Backend untouched. Browser interaction/mobile checks could not run: no Chromium binary, and Playwright's browser download was truncated/invalid. The layout and click-through flow still require browser QA against a live API.

Next: 4.17 row detail panel (deduction breakdown, employer cost). 15 main tasks remain (4.17–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.15 implemented (2026-10-28)

Decision: attendance deduction = basic salary × affected scheduled working days / all scheduled working days in the payroll month, excluding company holidays. Allowance is not reduced. Absence and approved unpaid-leave days are disjoint. Combined amount is rounded once using payroll rounding mode; unpaid-leave share is allocated first and absence gets the remainder, so rounding never deducts more than basic salary for a full month. Zero amounts are omitted. The rule is shown in Settings and recorded as basic_over_scheduled_working_days_v1 in approval snapshots. This is an explicit MVP calculation choice, not an assumed statutory rule.

Both existing payroll_settings switches default off. New HR-only GET/PATCH /api/payroll-settings/attendance-deductions validates boolean switches, locks settings, saves changed values and audits. No-op changes do not audit. Payroll Settings > Other Deductions now includes switches and formula text. Existing /calculation endpoint contract stays unchanged; loadSettings includes the two flags for the engine callers.

The attendance loader derives monthly counts directly from employee schedule/start date, holidays, approved leave type is_paid and attendance records; it does not mutate attendance and is not limited by the attendance list's 62-day fill window. Missing scans count as absence only on closed days in the configured company timezone; today counts after shift end. Worked days, incomplete/on_leave HR statuses, paid leave, holidays, off days and pre-employment days are excluded. Approved unpaid leave includes known scheduled days later in the month. Current schedules/holiday/leave data are used; the project does not retain historical schedule versions.

Generation adds calculated lines once. Draft edits remove old absence/unpaid_leave lines and rebuild them, while preserving manual/consumed one-time deductions. Turning switches off removes the respective draft lines on recalculation. Approval recomputes expected attendance lines and refuses stale drafts after leave/attendance/settings changes; explicit review/recalculation is required. Approved/paid snapshots remain unchanged.

Validation: backend 215 pass, 270 skipped, 1 existing todo, zero failures; frontend 111 pass and Vite production build passes. Five new attendance service tests plus a repeated-recalculation test pass. Three new DB integration tests cover policy access/audit, holidays/start-date/paid-vs-unpaid/absence and correction-driven stale approval, future absence exclusion and disabling. DB tests remain UNRUN because PostgreSQL is unavailable. Settings controls compiled but were not browser-tested against a live API.

Next: 4.16 nine-column salary-sheet table. 16 main tasks remain (4.16–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.14 implemented (2026-10-28)

POST /api/payroll/periods/:id/pay {paidOn: "YYYY-MM-DD"} records an external payment for an approved payroll. It validates a real calendar date (years 1000–9999); missing/invalid dates return 400. The endpoint uses existing HR, lock and CSRF middleware. User-supplied status/actor fields are ignored. No gateway or funds transfer occurs. Dates can be backdated or future dated; no chronology restriction was specified.

markPeriodPaid locks the period row FOR UPDATE, returns 404 for an absent period and 409 for draft/already paid periods, then saves status=paid, paid_on and the authenticated HR actor. It writes payroll.period.pay audit details (approved -> paid, month, payment date) within the same transaction. A failed audit rolls everything back. Concurrent submissions serialize: only one succeeds and one audit is written. Current settings/brackets are never loaded, so configuration changes after approval cannot block recording payment or rewrite approved amounts/snapshots. GET period detail includes paidOn as a date-only string and paidByUserId. Existing database immutability triggers remain in force. Creation, approval and payment each have transaction-bound audit records.

Validation: backend suite 209 passed, 267 skipped, 1 existing todo, zero failures. Three new service tests passed: date validation, exact metadata/audit changes, draft/paid/missing guards. Four DB integration tests cover saved date/actor and immutable history, role/lock/CSRF/input validation, concurrent submissions, and audit-failure rollback. These remain UNRUN because PostgreSQL is unavailable. No frontend changes; payment controls remain task 4.18.

Next: 4.15 unpaid-leave/absence deduction applied exactly once. 17 main tasks remain (4.15–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.13 implemented (2026-10-28)

POST /api/payroll/periods/:id/approve (HR only, session-lock and CSRF protected) transitions a nonempty draft to approved. It locks settings, period and entries in a repeatable-read transaction, validates brackets and recomputes each entry in memory against current tax/pension configuration and applicability flags, using reviewed entry salary amounts and its saved flat deductions. Approval never silently changes reviewed totals. A mismatch in any calculated field or full tax breakdown returns 409 stale_payroll with entryId; recalculate/review that entry via 4.12 before retrying. Invalid brackets/missing profiles/empty payroll return 422; absent period 404; repeat approval or paid period 409. Serialization/deadlock conflicts are retryable 409.

The versioned config_snapshot contains month, complete engine settings plus currency/attendance deduction switches, brackets, other taxes, every employee identity, salary/allowance and applicability flags, all calculated amounts and item breakdown. Approved time and approver are recorded server-side. The existing migration 004 triggers protect periods, entries and items after approval. No migration was modified. Approval writes one audit record in the same transaction. GET period detail now exposes approvedAt, approvedByUserId and configSnapshot to HR; future payslips should use saved data, never current config.

Validation: four new service tests pass, covering snapshot content, non-draft/missing/empty guards, stale totals/invalid brackets and renamed tax breakdown. Full backend suite: 206 passed, zero failures, DB tests skipped, one existing todo. Four new DB tests cover history after configuration/profile edits, stale-setting rejection/recalculation, permissions/concurrent approval, and rollback if audit insertion fails; NOT RUN because PostgreSQL is unavailable. No frontend changes; approval controls remain task 4.18.

Next: 4.14 mark paid with date and audit transitions. 18 main tasks remain (4.14–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.12 implemented (2026-10-28)

PATCH /api/payroll/periods/:id/entries/:entryId accepts basicMinor and/or allowanceMinor (nonnegative integer minor units). Unknown keys including derived totals are discarded; no allowed keys is 400. HR/session lock/CSRF checks apply. Period and entry are locked in a repeatable-read transaction; non-draft periods return 409, missing/mismatched entries 404, invalid calculation inputs 422, concurrent serialization/deadlock conflicts retryable 409.

All derived amounts are calculated by the existing engine using current tax/pension settings, current allowance/pension profile flags, the entry's edited basic/allowance and the entry's already allocated flat deductions. Omitted salary amounts remain as stored in the entry, not reset to the employee profile. Salary profiles are unchanged. Consumed one-time items and flat breakdown rows are preserved; salary edits never reconsume or newly allocate deductions. Other-tax lines are rebuilt from current settings. Each successful recalculation is audited, including a same-amount request (settings may have changed). All writes and audit roll back together on failure. Attendance-derived deductions remain task 4.15; salary-sheet editing UI remains task 4.16.

Validation: 5 new service tests pass (input validation, all derived amounts, preservation of salary/deductions, approved/paid lock, missing entries, invalid config). Four new PostgreSQL integration tests cover persistence and one-time preservation, access/lock/validation, approved/paid protection, and rollback after a breakdown write failure; unrun because PostgreSQL is unavailable. Backend full suite: 202 passed, 259 skipped, 1 todo, zero failures. No frontend files changed.

Next: 4.13 approve with immutable snapshot and blocked recalculation. 19 main tasks remain (4.13–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.11 implemented (2026-10-28)

POST /api/payroll/periods {month: "YYYY-MM"} creates and generates a draft atomically for all currently active employees. Requires a saved salary profile per active employee, valid tax brackets and at least one active employee. Client-sent totals/status are ignored. Duplicate months return 409. GET /api/payroll/periods (paginated), /periods/:id and /periods/:id/entries (paginated) provide HR access to results. All routes use no-store, HR role and existing session-lock/CSRF middleware.

Generation uses a repeatable-read transaction and the settings row lock. Loads settings, brackets, other taxes and salary inputs, calculates via the existing engine, saves employee identity, amounts and item breakdown, consumes only enabled/unconsumed one-time deductions, and writes one audit record. Recurring deductions remain available. Missing profiles/invalid brackets return 422. Serialization/deadlock conflicts return retryable 409. Any failure rolls back the period, entries, item consumption and audit together.

Validation: backend 197 pass, 255 skipped, 1 todo, zero failures. Four new service tests passed (month validation, prerequisites, authoritative amounts/item consumption, row mapping). Five PostgreSQL integration tests are written for access/lock isolation, persistence and deductions, invalid prerequisites, rollback and concurrent creation; NOT RUN because PostgreSQL is unavailable. No frontend changes this task; payroll table/month controls remain tasks 4.16–4.18. Attendance deductions remain 4.15.

Next: 4.12 draft entry edit with server recalculation. 20 main tasks remain (4.12–4.22 and 5.1–5.9). Older summaries below are historical.

---

# Latest session — task 4.10 implemented (2026-10-28)

Salary profile GET/PUT /api/salary-profiles/:employeeId (HR only, no-store, session lock enforced), exact minor-unit validation, transactional per-employee saves and audits. Unsaved profiles return zero defaults with saved=false. PUT replaces all values; optional flags default true. No-op saves do not write/audit. Employee IDs from the body are ignored.

Employees page has a Salary button and loading/retry/edit dialog for basic, allowance, taxable/pensionable allowance flags and pension applicability. Changes affect profile inputs for future payroll generation; draft recalculation remains task 4.11/4.12. No approved history is modified.

Validation: frontend 111 tests pass; Vite production build passes. Backend 193 pass, 250 skipped, 1 todo, zero failures. PostgreSQL unavailable: new profile integration tests (role/lock, persistence/audit, invalid input/404) are written but unrun. Dialog has not been browser-tested against a live API.

Next: 4.11 payroll period creation and draft generation. 21 main tasks remain (4.11–4.22 and 5.1–5.9). Earlier status summaries below are historical and may have stale counts.

---

# Natra ERP — Project Status

**Last updated:** 2026-10-28 (task 4.9 complete)
**Overall:** Phase 3 in progress (50 of 77 tasks done; Phase 3 code and tests complete but unrun; Phase 2's Day 9 device checkpoint still open); last full backend DB run 323 pass / 0 fail / 1 todo (task 3.4); **3.6, 3.7 and 3.8 backend DB tests are written but NOT run (no Postgres), and 3.6/3.7 pages were never built or rendered (no Vite)**; frontend 90 pass, pure backend files run here pass
**Current task:** 4.8b (one-time consumption rules and engine hookup), split into 8 subtasks 4.8b-1 to 4.8b-8 in `tasks/phase-4-payroll.md`; **4.8b done (all 8 subtasks; DB/HTTP tests written, NOT run); 4.9 (Payroll Settings page) split into 8 subtasks 4.9-1 to 4.9-8 in the phase file, 4.9 DONE (all 8 subtasks); next 4.10 salary profile API + edit form**. **This session `npm ci` worked: frontend `npm test` 109 pass and `npx vite build` succeeds (first real build of the 4.9 tabs); Postgres was not checked, so the backend DB tests are still unrun.** **Still outstanding, needs a machine where `npm install` works: run `npm test` with Postgres and fix whatever the unrun 3.6-3.9, 4.1 and 4.5-4.7 DB tests find, then tick the Day 12 checkpoint.**
**Current day / 21:** 4

> Updated at the end of every work session, then the folder is re-zipped.

## Session note: 4.9-7 and 4.9-8 (Payroll Settings page finished)
- `pages/DeductionsTab.jsx`: employee search + picker (`?employee=` in the URL, validated by `employeeFromParam`), items table (name/type, amount, status badge, Pause/Resume/Edit/Delete), add/edit dialog (type, name, amount, every-month, active). Used one-time items show "Already taken in a payroll" with no actions; a 409 from the server shows a toast and reloads. The employee list is the first 100 matches (API cap); typing in the search box narrows it.
- `PayrollSettings.jsx` lost its temporary `TabBody`; all four tabs are real components. CSS: only `.picker` was missing.
- Not yet seen in a browser: the four tabs compile and the pure logic is tested, but nobody has clicked through them against the live API. Do that when the 4.10 profile form is also in place.

## Phase progress
| Phase | Tasks | Done | Est. LOC | Actual LOC | Status |
|---|---|---|---|---|---|
| 2026-10-28 | 3.5: portal Leave page (balances, request form, my requests, cancel dialog), leaveView.js, CSS, route; 8 new tests; frontend 74 pass, build OK; **first page rendered in a real browser against the live API** | 3.5 | 3.6 |
| 2026-10-28 | 3.4: routes/leaveAdmin.js (queue, approve, reject, balances view + entitlement/adjust with mandatory reason), decideLeaveRequest/changeBalance in services/leave.js, 23P01 -> 409; 8 DB tests; full backend suite 323 pass / 0 fail | 3.4 | 3.5 |
| 2026-10-28 | 3.3: routes/leave.js (types, balances, requests list/create, cancel) + services/leave.js + schemas; days auto-counted, overlap + balance checks under a per-employee row lock; 13 new tests; **first real Postgres run: fixed 2 old test bugs**; full backend suite **315 pass / 0 fail / 1 todo**; frontend 66 pass | 3.3 | 3.4 |
| 1 Foundation | 17 | 17 | ~1,050 | ~2,150 code (1,156 backend + 1,002 frontend JS, + 198 CSS) + 1,942 tests + 120 SQL + ~88 config | Code complete; DB tests unrun |
| 2 QR Attendance | 20 | 20 | ~1,660 | ~1,130 (SQL 59, backend ~330, frontend ~250 incl. CSS, tests ~490, so far) | In progress |
| 3 Leave | 9 | 2 | ~750 | ~330 (SQL 90, backend 60, tests ~180) | In progress |
| 4 Payroll | 22 | 7 | ~2,010 | ~370 (engine 140, tests 150 + money 80) | In progress |
| 5 Test & Deploy | 9 | 0 | ~210 | 0 | Not started |
| **Total** | **77** | **39** | **~5,760** | **~4,500** (`wc -l`, blanks and comments included; real `cloc` in 5.8) | LOC target 7,000 · ceiling 9,000 |

## Checkpoints
- [ ] Day 4: login + employees + role isolation
- [ ] Day 9: full QR selfie flow on tablet and phone
- [ ] Day 12: leave affects attendance
- [ ] Day 18: payroll Draft → Approved → Paid + payslip
- [ ] Day 21: deployable, tested, documented

## Decisions log
| Date | Decision |
|---|---|
| 2026-10-19 | LOC target 7,000; extend up to 9,000 only if necessary (priority: security/correctness tests, payroll edge cases, failure handling, responsive CSS) |
| 2026-10-19 | UI layout follows `references/ui-notes.md` (top bar + left sidebar + card dashboard) |
| 2026-10-19 | **Theme: dark by default (as in reference) with a light-mode toggle**, via CSS variables (task 1.14) |
| 2026-10-19 | Charts are hand-written SVG, no chart library |
| 2026-10-19 | MVP restricted to same-day shifts (to be documented in README, task 5.7) |

## Build notes
- Node 22 / npm 10 in build environment; backend is ESM (`"type": "module"`), tests use built-in `node --test` + supertest.
- Password hashing: `bcryptjs` (pure JS, no native build on Render free).
- Deps chosen up front: express, pg, helmet, cookie-parser, cloudinary (backend); react, react-router-dom, lucide-react, qrcode, vite (frontend). Rate limiting and CSRF are hand-written (tasks 1.7/1.8).
- Plan and code now ship together in one zip: this folder is `natra-erp/plan/`, code is alongside it (`frontend/`, `backend/`, `database/`). Zip excludes node_modules.

- Server: `createApp()` exported from `server.js` (tests import `app`; listens only when run directly). Errors thrown as `HttpError(status,msg,code)` return `{error:{code,message}}`; 5xx messages hidden in production; error logs omit query strings (QR tokens) and bodies.
- Config fails fast in production if DATABASE_URL, SESSION_SECRET (>=32 chars) or FRONTEND_URL is missing.
- CORS is hand-written: only `FRONTEND_URL` is allowed, with credentials; allowed headers include `X-CSRF-Token`.
- `/health` does not touch the DB (cheap for UptimeRobot).
- JSON body limit 100 kb globally; the selfie route (2.12) will raise it locally.
- `npm test` uses `node --test` with no path (Node 22 glob; picks up `*.test.js`).

- DB: `db/pool.js` (max 5 conns, TLS via connection string, `query`, `withTransaction`). `db/migrate.js` applies `database/migrations/NNN_*.sql` in order, each in a transaction, once; advisory lock for concurrent starts; checksum check rejects edited applied migrations. `migrate()` is exported for the startup step (5.5).
- Tests needing Postgres read `TEST_DATABASE_URL` and skip if unset. Local test DB: Postgres 16, db `natra_test`, user `natra` (environment only, not in the repo).

## Schema notes (migration 001)
- Tables: users, sessions, departments, shifts, employees, audit_logs (+ set_updated_at trigger).
- Roles: CHECK limits `users.role` to 'hr' | 'employee' (no kiosk role, enforced in the DB).
- Sessions: PK is SHA-256 of the cookie token; `csrf_token` stored per session; `locked` + `locked_at` must agree (CHECK); absolute `expires_at` + `last_seen_at` for idle expiry.
- Shifts: same-day only (CHECK end_time > start_time), ISO weekdays in `work_days`, `grace_minutes`; a 'Standard' 09:00-17:00 Mon-Fri shift is seeded (illustrative).
- Employees: name/email live on users; salary will live in salary_profiles (004); `user_id` unique and RESTRICT (no hard delete); status active|inactive; code and email unique case-insensitively.
- audit_logs is append-only (trigger blocks UPDATE/DELETE; TRUNCATE allowed for test cleanup).
- No separate 'positions' table: job title is free text on the employee (not in the §21 table list).
- Tests that truncate tables refuse to run unless the DB name contains "test".

## Attendance schema notes (migration 002, task 2.1)
- `attendance_tokens`: only `token_hash` (SHA-256, unique) is stored; `issued_by_session_id` FK to sessions with ON DELETE CASCADE, so ending/deleting the issuing session kills its tokens. `used_at` and `used_by_employee_id` must be set together (CHECK); `expires_at > created_at`. The 45 s lifetime itself is applied in code (2.4), not in the DB.
- `attendance_records`: unique (employee_id, work_date) = `attendance_one_per_day`; employee FK is RESTRICT (no hard delete with history). Status values are snake_case: `present | late | absent | on_leave | incomplete`.
- CHECKs: check-out needs a check-in and must be later; present/late need a check-in (absent/on_leave rows may have none, for the Phase 3 classifier); `late_minutes > 0` only when status is `late`; a correction (`corrected_at`) needs a non-blank `correction_reason`.
- Selfie columns (`check_in_photo_id`, `check_out_photo_id`) hold Cloudinary public ids, never URLs; signed expiring URLs are produced on demand (2.9/2.17).
- `work_date` is the company-timezone date computed by the server (2.16), not the UTC date.
- `TRUNCATE_ALL` in tests/helpers.js now includes both new tables.

## Lock gate notes (task 2.10)
- `middleware/lock.js` exports `lockGate`, mounted globally in server.js right after CSRF. A request whose session is `locked` gets 423 `screen_locked` unless method+path is in `LOCKED_ALLOWLIST`: GET /api/auth/me, POST /api/auth/logout, POST /api/qr/tokens, POST /api/qr/unlock.
- Matching is exact and case-sensitive on the raw path (one trailing slash tolerated); anything odd (encoded, doubled slash, different case, other method) is refused. Login is deliberately NOT allowed while locked: logout first.
- Task 2.3 must create exactly `POST /api/qr/tokens` (2.4 generates) and `POST /api/qr/unlock`, with `allowLocked: true` on those and on /auth/me and /auth/logout, or change the allowlist in step. Two layers now: this gate (outer) and `requireRole` default-deny (inner).
- **Routes (2.3, `routes/qr.js`, mounted at /api/qr):** `POST /lock` (HR, unlocked only; sets sessions.locked/locked_at for the caller's session; audit `qr.lock`), `POST /unlock` `{password}` (re-verifies the HR user's bcrypt hash; 400 missing, 409 not locked, 403 `invalid_password`, 429 `rate_limited` with Retry-After; unlocks the caller's session only; audit `qr.unlock` / `qr.unlock_failed`). Router guard is `requireRole('hr',{allowLocked:true})`; `/lock` itself refuses an already-locked session.
- Unlock limiter `unlockLimits` (own instance, exported): 5 failures / 15 min per session, 10 per user. Success resets the session counter. Password is never stored or logged (audit redacts, only ip is recorded). Wrong password is 403 not 401 because the client treats 401 as "signed out".
- `POST /api/qr/tokens` (allowlisted) arrives in 2.4. Tests 2.8 should clear `unlockLimits` in beforeEach, as auth.test.js does for `loginLimits`.
- **Tokens (2.4):** `services/qrToken.js` `issueQrToken(db,{sessionId,userId})` returns `{token, expiresAt, ttlSeconds:45}`; token = 32 random bytes base64url; DB stores `hashQrToken` = HMAC-SHA256(SESSION_SECRET, 'qr:'+token). Issuing expires the session's earlier unused tokens (one live QR per session) and deletes tokens expired > 1 day. `POST /api/qr/tokens` (HR, allowed while locked) returns 201 `{token, expiresAt, ttlSeconds}`; capped at 30/min per session (`tokenLimit`, clear it in tests). Validation/consumption (hash lookup, expiry, used_at, issuing session still exists) is 2.12/2.14: look up by `hashQrToken(token)`, never by plain token.
- Not yet covered by an HTTP test (that is 2.8); `tests/lockGate.test.js` is a pure unit test and passes.

## QR page notes (task 2.10)
- `pages/QrAttendance.jsx` at /hr/qr: clock, `qrcode` library `toDataURL` (white background for scanning on the dark theme), countdown from the browser clock (arrival time + server `ttlSeconds`, no clock-skew dependence), Generate New QR / Generate Again, Lock. Stale responses from an older click are ignored. Expired code is hidden, not blurred.
- **QR content is `<origin>/portal/scan#token=<token>`: the token is in the URL fragment**, so it never reaches servers, logs or Referer headers. Task 2.10 must read it with `tokenFromHash()` (pages/qrState.js), keep it in router state across login, then clear the hash. `/portal/scan` route does not exist yet (2.10/2.11).
- `useAuth()` now exposes `setLocked(bool)`: the Lock button calls POST /qr/lock then `setLocked(true)`, so HrLayout switches to the locked shell without a reload. 2.7 should call `setLocked(false)` after a successful unlock.
- Company logo: no setting exists; header says "Natra attendance" (revisit in Settings if a logo is wanted).
- **Not rendered or compiled:** vite/react are not installed (registry blocked). 3 pure tests in tests/qrState.test.js pass (frontend 36 pass). First thing to do with network: `npm run build` and look at /hr/qr on a tablet-width viewport, locked and unlocked.
- Locked-mode polish (2.6) and the Unlock control (2.7) are not in this task: when locked, this page currently shows no Unlock button.

## Locked display notes (task 2.10)
- Locked state is restored from the server: AuthProvider loads `/auth/me` (allowed while locked), so a refresh stays locked. `layoutMode(locked, pathname)` in hrNav.js decides `normal | locked | redirect`; HrLayout renders no sidebar/top bar when locked and redirects any other /hr URL (address bar, back button) to /hr/qr. The server still refuses everything else with 423 (lockGate).
- Cross-tab: on window focus / tab becoming visible, AuthProvider re-reads `/auth/me` and follows the server's lock flag in both directions (no loading splash; a 401 signs out; other errors ignored). A 423 from any call also flips the UI to locked (existing client event).
- No logout control is shown while locked, by design: unlock first.
- **Unlock dialog (2.7):** `components/UnlockDialog.jsx`, opened by a small "Unlock" button on the locked QR page (the Lock button shows only when unlocked). Password lives only in component state, cleared on failure, close and success, `autoComplete="off"`, never stored. POST /qr/unlock; success -> `setLocked(false)` + toast, so HrLayout renders the sidebar again (the QR page remounts, so the on-screen code is cleared: generate a new one). Errors via `describeUnlockError` (wrong password / throttled with minutes / network). A 409 `not_locked` is treated as success. Dialog is cancellable (Cancel/Esc keeps the screen locked).
- Not rendered in a browser (no vite in sandbox); 1 new pure test (frontend 37 pass).

## Lock test notes (task 2.10)
- `backend/tests/lock.test.js`: 11 HTTP/DB tests against the real app, covering spec 26 #2 (423 on admin endpoints, allowlist works while locked), #3 (URL variants: trailing slash, case, double slash, dot-segments, query string), #4 (refresh/me keeps lock), #5 (missing/wrong/right password, throttle after 5 failures with Retry-After, audit rows without the password, employee/anonymous refused), #6 (two sessions of one user are independent, both directions) + the token replace/hash-only check from 2.4.
- **(Update 2026-10-28: now run and passing, see 'First real test run'.)** Originally NOT RUN. Only syntax-checked: npm registry was blocked in the sandbox, so Express/pg/supertest are not installed. **First action when you have network:** `cd backend && npm ci && TEST_DATABASE_URL=postgres://natra:natra@localhost:5432/natra_test npm test`, and also the never-run Phase 1 DB tests. Expect a few first-run fixes (likely spots: superagent normalising `..` in URLs, status of anonymous POSTs vs CSRF).
- Local test DB used in the sandbox: Postgres 16, role natra/natra, db natra_test (environment only).

## Photo storage notes (task 2.10)
- `services/cloudinary.js`: `createPhotoStore({sdk,cfg,now,random})` + default `photos`. SDK is imported lazily; without CLOUDINARY_* env every call throws 503 `storage_unavailable` (app still boots).
- `photos.upload(buffer)` -> public id `natra/selfies/<year>/<24 random chars>` (no employee data in the id). Uploaded as type `authenticated` so the plain URL does not work. Accepts JPEG only (magic bytes), max 600 KB (400 bad_photo / 413). Cloudinary failure -> 502 `storage_failed` with no detail leaked; callers must then NOT create attendance.
- `photos.signedUrl(id, ttl=300s, max 900s)` -> `{url, expiresAt}` using `private_download_url` (time-limited, signed). Never store or cache the URL; DB keeps only the public id (`attendance_records.check_in_photo_id` / `check_out_photo_id`).
- `photos.delete(id)` is idempotent ('ok' or 'not found'); used by orphan cleanup (2.15) and the photo retention/deletion procedure (document in 5.7). All three refuse ids that do not match `isPhotoId`.
- 8 unit tests pass with a fake SDK. **Done-when "URL without signature fails" is NOT verified against real Cloudinary** (no account/network here). Run `node --env-file=../.env scripts/cloudinary-smoke.js` once credentials exist: expects plain URL 404, unsigned authenticated URL 401/404, signed URL 200. The 1x1 JPEG in that script is hand-encoded; if Cloudinary rejects it, swap in any small real JPEG.
- Upload limit: the selfie route (2.12) must raise the JSON body limit locally (base64 of 600 KB is ~800 KB) or accept multipart; decision for 2.12.

## Token-through-login notes (task 2.10)
- Flow: tablet QR opens `/portal/scan#token=T`. If not signed in, `RequireRole` redirects to /login with router state `{from:'/portal/scan', qrToken:T}` (`loginRedirectState`); after login `LoginRoute` navigates to the target and passes `{qrToken}` only when the target is `/portal/scan` (`postLoginState`). `Scan.jsx` reads the token (`tokenFromLocation`: hash first, then state), then `navigate(..., {replace:true, state:{qrToken}})` to strip the fragment from the address bar/history. All helpers in `pages/portal/scanToken.js`, pure and tested (4 tests, frontend 42 pass).
- Never leaves the browser except as the request body to our own API (2.12): fragment is never sent by browsers, router state is `history.state` (same tab/origin, not storage, not a URL), `index.html` has `<meta name="referrer" content="same-origin">`, no external links carry it. A token that fails the format check is ignored everywhere.
- HR opening a scan link is bounced to /hr by RequireRole (HR is not an attendee). Employees without a token see a "scan the tablet" hint.
- `Scan.jsx` was a stub here; 2.11 added the camera (see Selfie capture notes); 2.12/2.14 add the submit. A refresh of the scan page keeps the token (history.state); closing the tab drops it.
- Not rendered in a browser (no vite).

## Selfie capture notes (task 2.11)
- `api/image.js`: `compressToTarget(encode, w, h)` bisects JPEG quality (0.4-0.92) for the largest file <= 160 KB (preferred; 200 KB is the stated ceiling, server hard cap 600 KB), starting at max side 960 px; if even quality 0.4 is too big it shrinks the picture 15% at a time (floor 320 px). `captureSelfie(video)` draws the current frame (NOT mirrored: the saved photo shows the scene as it is) to a canvas and returns `{blob,width,height,quality}`. `describeCameraError` maps getUserMedia errors to short friendly text (raw errors never shown).
- `Scan.jsx` steps: idle -> starting -> live -> captured. The camera opens only on a button tap (iOS permission prompt), `facingMode:'user'`, audio off. **No `<input type=file>` anywhere: no gallery path.** Live preview is mirrored by CSS only; stream tracks are stopped after capture, on Retake restart and on unmount (also if the page is left while the permission prompt is open). The photo is held as a Blob in component state with an object URL (revoked on retake/unmount); nothing is stored or uploaded.
- "Use this photo" is a disabled placeholder: **2.12/2.14 wire the submit** (send `photo.blob` plus the token; the selfie route must raise the body limit or take multipart, see photo storage notes).
- **Not rendered or run in a browser:** no vite/network in the sandbox, so camera permission, mirrored preview, real JPEG sizes and iOS Safari behaviour are unchecked. 6 pure tests added (frontend 48 pass); JSX transpile-checked only. **Manual check on a phone over https (getUserMedia needs a secure origin):** open a `/portal/scan#token=...` link, tap Open camera, deny once (message + retry), allow, take, check the Photo size line is ~100-160 KB, Retake, leave the page and confirm the camera light goes off.

## Scan submit endpoint notes (task 2.12)
- `routes/attendance.js`, mounted at `/api/attendance`, router-level `requireEmployee` (HR 403, anonymous 401; a locked HR session never gets this far: lockGate 423). **`POST /api/attendance/scan` body `{ token, photo }`**: `photo` is the **raw base64 of a JPEG, no `data:` prefix** (the frontend must strip it; Blob -> base64 via FileReader). Responses so far: 400 `validation` with `details.fields` (`token` / `photo`), 403 `no_employee_record` / `employee_inactive`, 400 `invalid_token`, 409 `token_used`, 410 `token_expired`, 429 `rate_limited` (+ Retry-After), then (from 2.15) **201** with the confirmation payload; the 501 skeleton is gone.
- Check order: rate-limit gate -> body validation (`services/scanRequest.js` `parseScanBody`: token shape 20-128 url-safe chars, base64 charset, size <= 600 KB, JPEG magic bytes) -> employee record active -> token. Inactive accounts therefore learn nothing about tokens.
- Token check (`services/qrToken.js` `checkQrToken(db, token)`, pure decision in `tokenProblem(row)`): lookup by `hashQrToken`; unused, unexpired (DB clock, `now()`), issuing session exists and is unexpired, issuer is an active HR user. Unknown token and unauthorised issuer return the same `invalid_token` message. A locked tablet session still counts as a valid issuer. **It is a read-only check: it does not reserve the token.** 2.14 must repeat the lookup with `FOR UPDATE` inside the transaction and set `used_at`/`used_by_employee_id` there.
- Throttle `scanLimits.user` (exported, clear it in tests): 10 failed token checks / 5 min per user; once blocked even a good token gets 429.
- **Body limit:** server.js skips the global 100 kb JSON parser for exactly `/api/attendance/scan`; the route parses its own body (~800 KB) after the role guard, so an anonymous caller cannot make the server parse a large body. Other paths (including `/api/attendance/scan/` with a trailing slash) keep 100 kb. Over the route cap -> 413 `too_large`.
- (Update 2.19: the frontend submit and confirmation are now built in Scan.jsx.)
- **NOT RUN against a database:** `tests/scan.test.js` (12 HTTP/DB tests: auth, validation, unknown/expired/used token, ended and expired issuer session, deactivated HR issuer, inactive employee, no record, locked-tablet token, throttle, body limits). Only syntax-checked; no Postgres/node_modules here this session. `tests/scanRequest.test.js` (8 pure tests) passes. First run with a DB, likely spots: the 413 login case, supertest anonymous POST vs CSRF.

## Next-action logic notes (task 2.13)
- `services/attendance.js`: `nextAction(record)` (pure) and `decideAction(db, employeeId, workDate, {lock})`. **The server decides check-in vs check-out; the browser never sends an action**, so a check-out before a check-in cannot be requested (spec 26 #10).
- Rules: no row -> `check_in`; row without check-in (pre-created absent) -> `check_in`; `on_leave` row without check-in -> 409 `on_leave`; checked in, not out (also status `incomplete`) -> `check_out`; checked in and out -> 409 `already_checked_out` (the "second check-in same day" refusal).
- `lock: true` adds `FOR UPDATE`: use it inside the 2.14 transaction so two simultaneous scans by one person queue up. **With no row there is nothing to lock:** the insert in 2.14 must map unique violation 23505 (`attendance_one_per_day`) to 409 `already_checked_out`/retry, and then re-decide.
- `workDate` is passed in as 'YYYY-MM-DD'; the route computes it with `companyDate()` (company timezone, see 2.15 notes).
- Not added (decision for you): a minimum gap between check-in and check-out, so an accidental double scan seconds apart does not immediately check the person out. Say if you want it (e.g. refuse a check-out within 60 s, 409 `too_soon`).
- Tests: `tests/attendanceAction.test.js` 7 pure tests pass. `tests/attendanceDecide.test.js` (4 DB tests incl. a two-connection row-lock test) is NOT RUN (no Postgres here); syntax-checked.

## Scan transaction notes (task 2.14)
- `services/attendance.js` `applyScan({employeeId, userId, token, workDate, photoId, checkIn, run})`, one DB transaction: (1) `checkQrToken(db, token, {lock:true})` = lookup + `FOR UPDATE OF t`, so a second scan with the same token waits, then sees `used_at`; (2) `decideAction(..., {lock:true})` locks the person's record; (3) consume the token (`used_at`, `used_by_employee_id`, guarded by `used_at IS NULL`, 0 rows -> 409 `token_used`); (4) INSERT/UPDATE the record with the **DB clock** (`now()`), (5) audit `attendance.check_in|check_out` (entity attendance_record, details `{workDate}` only, no photo id, no token). Any throw rolls everything back, **so the token is consumed only on commit** and a refused or failed scan leaves it usable until it expires.
- Lock order is always token -> record (no deadlocks). First check-in with no row uses `INSERT ... ON CONFLICT ON CONSTRAINT attendance_one_per_day DO NOTHING`; if a simultaneous scan by the same person won, the loser gets 409 `duplicate_scan` and keeps its token (the transaction is not aborted by a unique violation). A pre-created absent row is filled in by UPDATE. Check-out sets `check_out_photo_id` and `statusAfterCheckOut` (an `incomplete` row returns to late/present from its stored late minutes; other statuses unchanged).
- **Inputs still to be supplied by later tasks:** `photoId` = Cloudinary public id already uploaded (2.15 uploads BEFORE calling applyScan and deletes the photo if it throws); `workDate` in the company timezone and `checkIn: {status, lateMinutes}` (2.16; default is present/0, used only when the scan is a check-in). `run` defaults to `withTransaction` (lazy import so pure tests run without `pg`); tests inject a fake.
- Wired into `POST /api/attendance/scan` by 2.15 (see below).
- Tests: 6 new pure tests in `tests/attendanceAction.test.js` (operation order with a fake transaction; refusals write nothing; lost token race; bad date/photo id rejected before a transaction), 13 pass there. `tests/attendanceScan.test.js` (9 DB tests: check-in, check-out then refusal, replay, **rollback after the token update** via a CHECK violation, late status kept, absent/on_leave/incomplete rows, same-token race between two people, same-person double check-in race, expired/unknown) is NOT RUN (no Postgres/node_modules here); syntax-checked.

## Upload-before-commit and wiring notes (task 2.15)
- `services/attendance.js` `submitScan({employeeId,userId,token,photo,workDate,checkIn,photos,apply,decide,log})`: (0) non-locking `decideAction` first, so a doomed scan (already checked out, on leave) is refused **before any upload**; (1) `photos.upload(buffer)`: if it throws (502/503) nothing else happens, no attendance, token untouched, the same token works on retry; (2) `applyScan`: on ANY failure the uploaded photo is deleted and the **original error is rethrown**; if the delete itself fails the random photo id is logged as `[orphan-photo] could not delete <id>` (no employee data in it) and the original error still wins. Photos left by a crash between steps 1 and 2 are covered by the retention/deletion procedure (5.7).
- `companyDate(now, tz)`: today's date in the company timezone via Intl (`config.timezone`, default Africa/Addis_Ababa), never the UTC date. 2.16 reuses it.
- **Route now complete:** `POST /api/attendance/scan` -> 201 `{action, workDate, employee:{fullName, employeeCode}, at, checkInAt, checkOutAt, status, lateMinutes}` (no photo id, no token). Photo store is swappable via exported `scanDeps.photos` (tests use an in-memory fake; production uses `services/cloudinary.js`, so without CLOUDINARY_* env the route returns 503 `storage_unavailable`).
- **Until 2.16 every check-in is stored as `present` with 0 late minutes** (the route passes no `checkIn`). Do not deploy before 2.16.
- Reconciled this session: a second, divergent 2.13 draft (pure `decideAction(record, now)`, `companyWorkDate`/`findRecord`, a 60 s `too_soon` rule, `tests/attendanceRules.test.js`) had been left in the route, tests and notes while `services/attendance.js` held the version described under 2.13. The project now has ONE 2.13: the one in these notes, with no minimum gap. The leftover test file, the `too_soon` test and the duplicate notes were removed.
- Tests: pure suite `tests/attendanceAction.test.js` 20 pass (7 new: order decide->upload->apply, refusal before upload, upload failure, cleanup after failed transaction with the ORIGINAL error rethrown, cleanup after a token race, cleanup failure logged, companyDate zones). DB/HTTP (NOT RUN, no Postgres): `scan.test.js` updated (201 check-in with confirmation and no leaked ids, check-out, third scan 409 without upload, upload failure 502 with token reusable, completed-day refusal uploads nothing), `attendanceScan.test.js` +2 (real DB failure after upload deletes the photo; success keeps it).

## First real test run (2026-10-28, with task 2.16)
- The sandbox had registry + Ubuntu mirror access this time, so for the first time: `npm ci` (backend, frontend), Postgres 16 installed from apt, `TEST_DATABASE_URL=postgres://natra:natra@localhost:5432/natra_test npm test`. **Backend: 249 tests, 248 pass, 0 fail, 1 todo** (the salary-isolation todo from 1.17). Without a DB: 113 pass, 135 skip. **Frontend: 48 pass; `vite build` succeeds** (238 kB JS / 78 kB gzip).
- The previously never-run DB suites (Phase 1 employees/orgstructure/auth/csrf/session, lock.test.js, scan.test.js, attendanceScan.test.js, attendanceDecide.test.js) needed only **three test fixes, no product-code fixes**: (1) `scan.test.js` did not reset the fake photo store or `attendance_tokens` between tests, so one failure cascaded into six; (2) `auth.test.js` created two supertest requests before awaiting either (supertest closes its server after the first); (3) `lock.test.js` did not clear `sessions`, so `count(locked)` saw other tests' sessions.
- Still NOT verified: real Cloudinary (smoke script), a real browser/phone (camera, QR page, iOS), `render.yaml` deploy. The React pages compile (vite build) but have not been looked at in a browser.
- Local test DB recipe: `initdb`, role `natra`/`natra` superuser, db `natra_test`; environment only.

## Status and late-minutes notes (task 2.16)
- `services/attendanceStatus.js`: pure `classifyCheckIn({at, workDate, shift:{startTime, graceMinutes, workDays}, timeZone})` -> `{status:'present'|'late', lateMinutes}`, and `classifyForEmployee(db, {employeeId, workDate})` (one query: the employee's shift JOIN + `now()`).
- **Rules (decisions, change here if HR wants otherwise):** on time up to and INCLUDING start + grace; one second later is `late`. **`late_minutes` counts from the shift START (not from the end of grace), rounded UP**, so a late row always has >= 1 minute (matches the DB CHECK). A scan on a day that is not one of the shift's `work_days` is `present`, 0 minutes. Public holidays and approved leave were added in 3.8 (holiday = present, 0 minutes; approved leave = scan refused, see the 3.8 notes). Check-in after the shift end is still `late` (no cap). Shift times are wall-clock in the company timezone (`COMPANY_TIMEZONE`, default Africa/Addis_Ababa); no DST handling needed there, and a date mismatch between the instant and the work date (scan right at midnight) is counted in whole days rather than wrapping.
- **Same clock as the stored timestamp:** `applyScan` takes a `classify(db, {employeeId, workDate})` callback, run INSIDE the transaction and only when the scan is a check-in (after the token and record locks, before the write). Postgres `now()` is fixed per transaction, so the `now()` used for classification is exactly the `check_in_at` that is stored. A refused scan, a check-out, or a failing classify writes nothing. `applyScan` still accepts a fixed `checkIn` (tests); `submitScan` forwards `classify`; the route passes `classifyForEmployee`. **The "do not deploy before 2.16" warning is cleared.**
- Check-out keeps the check-in's status and late minutes (unchanged `statusAfterCheckOut`).
- Tests: `tests/attendanceStatus.test.js` (22 pure: boundaries at start / grace / +1 s, zero grace, timezone vs UTC, day off, midnight, DB-CHECK invariant, fake-db helper, applyScan order). DB: 2 in `attendanceScan.test.js` (late minutes equal the minutes computed from the stored `check_in_at`; non-work day), 2 new + 1 pinned in `scan.test.js` (shift is pinned per test so results never depend on the time of day the suite runs).
- Not done / open: a per-employee override or per-day shift (not in spec); `late_minutes` from the end of grace is a one-line change in `classifyCheckIn` if preferred.

## HR attendance list and selfie links notes (task 2.17)
- **New router `routes/attendanceRecords.js`, mounted at `/api/attendance-records`** (HR only: `router.use(noStore, requireHr)`). It is separate from `/api/attendance` because that router is guarded with `requireEmployee` at router level (the structural guard test needs a router-level guard, and HR would get 403 there). A locked tablet gets 423 (default-deny), employees 403, anonymous 401. Task 2.18's correction endpoint goes in this same file (`PATCH /:id`).
- `GET /?page&pageSize&from&to&employeeId&departmentId&status` -> `{items, page, pageSize, total}` (shared list contract), sorted work date DESC, then name. `from`/`to` are inclusive work dates (`YYYY-MM-DD`; same date twice = one day); no date given = all dates (the 2.18 page should send today's date by default). `from` after `to` -> 400 on `to`. Bad status/date/id, repeated params, `pageSize` > 100 -> 400 with field names. All values are bound parameters; the column names in the WHERE come from a fixed list.
- Item: `{id, employeeId, employeeCode, fullName, departmentId, departmentName, workDate, checkInAt, checkOutAt, status, lateMinutes, hasCheckInPhoto, hasCheckOutPhoto, correctedAt, correctedByName, correctionReason}`. **Photo ids never appear in the list**, only booleans.
- `GET /:id/photos/check_in|check_out` -> `{url, expiresAt}`: signed, time-limited link from `services/cloudinary.js` `signedUrl` (default 5 min, hard max 15), `Cache-Control: no-store`, never stored. 404 `no_photo` (record has none) / `not_found`; 400 for a bad kind or id; **503 when Cloudinary is not configured** (note: the error handler reports every 5xx with code `server_error` by design, so clients branch on the status). **Every successful view is audited** as `attendance.photo_view` with `{kind, employeeId}` (no photo id, no URL); failed lookups write nothing. The 2.18 viewer should request the link when HR opens the photo (not when the list loads) and must not cache it; it expires.
- Photo store is swappable via exported `recordDeps.photos` (tests use a fake; production uses the real service).
- Tests: `tests/attendanceRecords.test.js`, 9 DB tests (auth/lock, contract + ordering, all filters and combinations, pagination, validation + injection strings, signed link + expiry + audit, error cases). Whole backend suite: 258 tests, 257 pass, 1 todo.
- **Not done / for later:** employee name search on this list (spec asks for date + employee filters; `employeeId` is the filter, and the 2.18 page can use the employees list for a picker); CSV export is not in the spec; real Cloudinary links still unchecked (smoke script).

## HR attendance page and correction notes (task 2.18)
- **Correction API:** `PATCH /api/attendance-records/:id` (same HR-only router as 2.17; locked tablet 423). Body: `reason` (REQUIRED, 3-500 chars, trimmed) plus any of `status`, `checkInTime`, `checkOutTime` (`HH:MM`, wall-clock in the COMPANY timezone on the record's work date; `null` clears), `lateMinutes`. Omitted = unchanged; unknown keys (employeeId, workDate, photo ids...) are dropped, so they cannot be set. Selfies are never changed. Returns the updated record.
- Runs in one transaction with the row locked `FOR UPDATE` (a live scan for the same person waits and then sees the corrected row; two simultaneous corrections serialise). Stamps `corrected_by_user_id / corrected_at / correction_reason` (latest correction wins) and writes audit `attendance.correct` with `reason` and `details {employeeId, workDate, changes:{field:{from,to}}}` (ISO instants). Every correction is in the audit table, so history is never lost.
- **Rules (400 with `details.fields`):** Present/Late need a check-in (`checkInTime`); a check-out needs a check-in and must be later (`checkOutTime`); `Late` needs minutes >= 1 (`lateMinutes`): if omitted they are recomputed from the employee's shift with the same classifier as scans (2.16), or kept when the check-in time did not change; non-Late status sets minutes to 0 and `lateMinutes > 0` with a non-Late status is rejected; a request that changes nothing is 400 `no_change` (no stamp, no audit row). The status is never auto-changed when only a time is edited: HR chooses it. Check-out-without-check-in and similar are caught here, with the DB CHECKs as the backstop.
- **List additions (2.17 contract extended):** each item has `checkInTime` / `checkOutTime` as `HH:MM` strings in the company timezone (the browser's time zone is never used to show or edit times), and the list response has `today` (company date) for the page's "Today" button.
- **Page** `pages/Attendance.jsx` (route `/hr/attendance`): filters From / To / Employee / Department / Status, "Today" and "Clear filters", 20 per page with the shared Pager, columns date, employee (+ID), department, in, out, status badge (+ late minutes, "Corrected by ..." with the reason as tooltip), selfie buttons (only when a photo exists), Correct. With no filters it shows the latest records first. Employee filter is a dropdown of up to 100 employees (the employees API cap): with more than 100 employees it needs a search box, not built.
- **Selfie viewer:** a modal that requests the signed link only when opened (each view is audited by the server), keeps it in component state only, drops it on close, shows loading / error (503 -> "storage not available", broken image -> "link may have expired") with Try again. **Unverified with real Cloudinary:** that `private_download_url` links display in an `<img>` (it is a download endpoint); if the browser shows a download instead of an image, switch the service to a signed delivery URL.
- **Correction dialog** `pages/CorrectionDialog.jsx`: status, minutes (Late only; blank = calculate), check-in/out `time` inputs, required reason; sends only changed fields (`pages/attendanceForm.js`, pure, 10 tests); server field errors show under the inputs.
- Tests: backend `tests/attendanceRecords.test.js` now 20 tests (11 new for corrections: auth/lock, reason required, timezone conversion + audit content, Late/Present minutes, rules, absent row -> present, clearing check-out, no-change, mass-assignment, history + concurrency, list local times). Frontend `tests/attendanceForm.test.js` 10 tests. Suites: backend 269 (268 pass, 1 todo), frontend 58 pass, `vite build` OK (248 kB JS / 81 kB gzip).
- **NOT rendered in a browser** (no Chromium available in the sandbox this session); check on a real machine: open /hr/attendance, filter, open a selfie (needs Cloudinary), correct a record with and without a reason, look at 390 px width. Not built: bulk corrections, creating a record for a person who never scanned and has no row (HR can only correct existing rows until Phase 3's absence classifier creates them; decide whether HR needs a "add record" action).

## Employee history and confirmation notes (task 2.19)
- **Bug fixed (from 2.15):** `companyDate()` read `config.timezone`, which does not exist (the setting is `config.company.timezone`), so with no explicit argument it silently used the SERVER's zone (UTC on Render): the work date would have flipped at 03:00 Addis time, and late/absent logic keyed on it. Both `companyDate` and the new `companyTime` now default to `config.company.timezone`; a pure test pins this (`attendanceAction.test.js`, 21 pass). Earlier tests passed because they always supplied a zone. **Worth a look at any other `config.timezone` use: grep found none left.**
- **Scan confirmation (spec 7 step 5):** `POST /attendance/scan` 201 now also returns `atTime`, `checkInTime`, `checkOutTime` as `HH:MM` in the company timezone (`companyTime()` in services/attendance.js). `Scan.jsx` now submits: Blob -> raw base64 (`blobToBase64` in api/image.js) + token -> `POST /attendance/scan`. A synchronous ref guard stops a double tap sending twice. On success it shows a confirmation card (name, date, time, check-in, check-out, status badge with late minutes) with links to History and Home, frees the photo, and clears the token from history state (a refresh/Back cannot offer the spent code).
- **Failure handling** (`pages/portal/attendanceView.js` `describeScanError`, pure): `retry` (network, 5xx/storage, 429 with minutes, duplicate_scan: photo kept, button says Try again, message says plainly the attendance was NOT recorded), `retake` (photo refused: Try again disabled until Retake), `rescan` (invalid/expired/used token: ask HR for a new QR; photo dropped), `stop` (already checked out today, on leave, inactive/no record: photo dropped). Raw server text, tokens and photo ids are never shown.
- **History API:** `GET /api/attendance/mine?page&pageSize&from&to` in `routes/attendance.js` (employee-only router guard; HR 403, anonymous 401). The employee comes from the session; `employeeId`/`userId` params are ignored (schema strips unknown keys). Returns `{items,page,pageSize,total}`, newest first; item = `{id, workDate, checkInTime, checkOutTime, status, lateMinutes, corrected}`. No photo ids, no correction reason, no HR name (employees only see `corrected: true`, shown as "Adjusted by HR"). `from` after `to` -> 400 on `to`.
- **Page** `pages/portal/History.jsx` at `/portal/attendance` (replaces the placeholder): From/To dates (two columns even on a phone), Clear dates, 20 per page, shared Table/Pager, loading/error/empty states.
- **Tests:** frontend `tests/attendanceView.test.js` 8 pure tests (confirmation fields, odd payloads, every error mapping, singular/plural minutes, no leaked server text, history rows, data-URL strip); frontend suite **66 pass**. Backend `tests/attendanceMine.test.js` 5 DB tests (auth, own rows only + company-time HH:MM + no photo ids, other employee not requestable, date filters/pagination/400s, corrected row hides reason/name) and 2 extra assertions in `scan.test.js`: **NOT RUN, no Postgres and no network in this session's sandbox (npm ci could not reach the registry). Syntax-checked only.** JSX transpile-checked only; `vite build` not run.
- **First thing next session with network:** `cd backend && npm ci && TEST_DATABASE_URL=postgres://natra:natra@localhost:5432/natra_test npm test`, then `cd ../frontend && npm ci && npm run build`. Likely first-run spot: the `corrected` update in `attendanceMine.test.js` needing the `corrected_by_user_id` FK.
- **Manual check on a phone over https:** scan a tablet QR, take the selfie, tap Use this photo, confirm the card; scan again for check-out; open the Attendance tab; try an old/used QR (expects the 'ask HR for a new QR' message) and airplane mode (expects 'not recorded, try again' with the photo kept).
- Not built: showing the HR "correction reason" to the employee (deliberately hidden); a manual 'I forgot to scan' request (not in the spec).

## Spec 26 #7-11 test notes (task 2.20)
- `backend/tests/attendance.test.js` (12 DB tests) states each spec test as a whole through the real app: **#7** token lifetime ~45 s in the DB, expired -> 410 with no record/upload/consumption, a newer QR from the same session ends the older one; **#8** a used token is 409 for the same person and for another, one record, one photo, token remembers who used it; **#9** two people with one token -> exactly one 201 + one 409 and the loser's photo deleted, one person with two tokens at once -> one row, and the DB constraint `attendance_one_per_day` rejects a duplicate directly; **#10** first scan is always check-in even if the body claims `action: check_out`, DB CHECK and the HR correction API both refuse a check-out without a check-in; **#11** no employee-facing body contains a photo id, stored value is an id not a URL, signed link only for unlocked HR (anonymous 401, employee 403, locked 423), `no-store`, expiry <= 15 min, list shows booleans only, views audited without the id or URL.
- **NOT RUN** (no Postgres/network again): syntax-checked only. Unverified guesses: the 'newer QR ends the older' case expects `token_expired` (410); the same-person double scan accepts either outcome (one row, kept photos match the row). Fix the test, not the code, if these differ, after checking the intended behaviour.
- Spec #11 still needs the real-Cloudinary smoke script (`scripts/cloudinary-smoke.js`) before it is fully proven.
- **Before starting Phase 3, with network:** run backend + frontend suites and `vite build` (2.19 and 2.20 added ~19 unrun DB tests), then the Day 9 phone check (checkpoint in the Checkpoints list).

## Leave schema notes (migration 003, task 3.1)
- **NOT APPLIED / NOT RUN:** no Postgres in this sandbox (and no SQL parser); the file was proofread only. **First thing with a DB: `npm test` (migrate applies 003, then the 6 new schema tests).** If `CREATE EXTENSION btree_gist` is refused (a managed Postgres that does not allow it for the app role), tell me: the fallback is dropping the exclusion constraint and enforcing overlap with a row lock in the approve transaction. On Render's Postgres 13+ it is a trusted extension and should work.
- Tables: `leave_types` (seeded annual/sick/personal/unpaid; `is_paid`, `has_balance`, `default_days`; entitlements are illustrative), `leave_balances` (employee, type, year; `entitled_days` + signed `adjusted_days`; total can never go below 0), `leave_requests`, `holidays` (unique date, name). `TRUNCATE_ALL` includes the three data tables (not `leave_types`, which is seed data).
- **Decisions (change here if HR wants otherwise):** (1) leave is in WHOLE working days (no half days); (2) a request must start and end in the same calendar year (`leave_requests_one_year`), so each request is charged to one year's balance; (3) **balances store only the entitlement + HR adjustment; used and pending days are always computed from requests**, so they cannot drift; every adjustment is audited with its reason (no separate adjustments table, spec allows consolidating); (4) `days` on a request is a snapshot computed by the server at request time (3.2/3.3), so a later holiday edit does not change an approved request; (5) status values pending|approved|rejected|cancelled; approved/rejected need `decided_at`, **a rejection needs non-blank remarks** (DB CHECK), cancelled is the employee's own withdrawal; (6) unpaid leave has no balance (`has_balance=false`, default_days 0).
- **No overlapping approved leave is enforced by the database:** `leave_no_overlapping_approved` is a GiST exclusion constraint on (employee, daterange inclusive) for `status='approved'`; two simultaneous approvals cannot both commit, and ranges touching on one day conflict. Violation is SQLSTATE **23P01** (not 23505): **3.3/3.4 must map it in `services/dbErrors.js`** to a 409 with a friendly message. Pending requests may overlap each other in the DB; the API (3.3) rejects a new request overlapping an existing pending/approved one for a clear message.
- Hard delete: employees and leave types with requests/balances are RESTRICT (history survives).
- Not in 3.1: per-year auto-creation of balance rows (3.3/3.4 create-on-demand from `default_days`, decision for 3.4), public-holiday UI (3.7).

## Working-day calculator notes (task 3.2)
- `services/workdays.js`, **pure and fully tested here** (11 tests in `tests/workdays.test.js`, all pass; mutation-checked: dropping the holiday test, the weekday test, the range end or the order check each fails tests). No time zones are involved: dates are plain calendar dates.
- API: `workingDaysBetween({start, end, workDays, holidays}) -> {days, dates}` (inclusive; `holidays` = any iterable of YYYY-MM-DD; duplicates and out-of-range holidays are harmless; a holiday on a non-work day is not subtracted twice); `isWorkingDay(ymd, workDays, holidays)`; `workingDaysForEmployee(db, {employeeId, start, end}) -> {days, dates, shiftId}` = the employee's own shift `work_days` (one query) + holidays inside the range (one query, bound parameters), works with the pool or a transaction client; `dayNumber/formatDay` helpers.
- Rules: a day counts if its ISO weekday is in the shift's work days and it is not in `holidays`. **A range with zero working days returns `days: 0`; 3.3 must refuse it** (DB CHECK `days >= 1`). Impossible dates (2026-02-30) are rejected, never rolled over. Range cap 366 days (safety only; the one-calendar-year rule is the DB CHECK from 3.1). `shifts.work_days` is the only schedule: there is no per-employee override.
- Errors are plain `Error`s with readable messages; 3.3 validates dates with the schema first (so users get field messages) and maps anything else to 400.
- `workingDaysForEmployee` is only tested with a fake db here (the SQL is two trivial SELECTs, to be exercised by 3.3/3.9 DB tests).
- 3.8 can reuse `isWorkingDay` for the absence calculation (schedule + holidays + leave).

## Leave -> attendance notes (task 3.8)
- **NOT RUN against Postgres** (none in this sandbox): the new SQL (`fillAttendanceGaps`, the leave/holiday flags in `classifyForEmployee`, the conversion UPDATE) was only proofread; 8 DB tests in `tests/attendanceGaps.test.js` are written, not run. 8 pure tests run and pass (attendanceStatus 28, attendanceGaps pure 1).
- **Design: no scheduler.** The scan flow (2.13/2.14) already expected pre-created rows (`absent` is filled in by a scan, `on_leave` refuses one), so `services/attendanceStatus.js` writes them on demand with one idempotent `INSERT ... SELECT ... ON CONFLICT DO NOTHING`: `fillAttendanceGaps(db, {from, to, employeeId?})`. Callers: (1) the HR attendance list (`GET /api/attendance-records`) fills the dates it is about to show (`fillWindow`: requested dates, at most 62 days back, never later than today, default last 31 days; swappable as `recordDeps.fillGaps`, switched off in the two row-counting test files); (2) leave approval, for the approved range (`applyApprovedLeaveToAttendance`, same transaction as the approval).
- **Rules (decisions, change here if HR wants otherwise):** a row is created only for ACTIVE employees on or after their start date, on their shift's work days, never on a public holiday. `on_leave` when approved leave covers the date (written even for days still to come, so a scan is refused from the first minute); otherwise `absent`, but only once the day is over (a past date, or today after the shift end time). Existing rows are never overwritten. A holiday inside approved leave gets no row.
- **Retroactive approval:** earlier `absent` rows with no check-in inside the approved range become `on_leave`. A row with a check-in stays as it is (the person did work; HR can correct it).
- **Scan on a leave day:** `classifyForEmployee` now also reads "is a holiday" and "approved leave covers the date" in the same single query: leave -> 409 `on_leave` (rolls the transaction back, token stays usable), holiday -> `present`, 0 late minutes (same as a day off). `classifyCheckIn` gained a pure `holiday` flag.
- **Still open / not done here:** `incomplete` (checked in, never checked out) is not assigned by anything yet; unpaid-leave and absence deductions are 4.15 (it can count `absent` rows plus approved unpaid-leave days from `leave_requests`); the dashboard cards are 4.21 (they will count `on_leave` / `absent` from `attendance_records` for today).
- The leave approval audit row now carries `attendanceRows` (how many rows were converted or created).

## Payroll schema notes (migration 004, task 4.1)
- **NOT APPLIED / NOT RUN** (no Postgres here, no SQL parser): proofread only. **First thing with a DB: `npm test`** (migrate applies 004, then the 7 new payroll tests at the end of `schema.test.js`). Likely trouble spots if it fails: the GiST exclusion on `int8range(...)` in `income_tax_brackets`, the three `plpgsql` guard functions.
- Tables: `payroll_settings` (single row), `income_tax_brackets`, `other_taxes` (extra table: spec 15 needs it; the task list only named `deduction_items`), `salary_profiles`, `payroll_periods`, `deduction_items`, `payroll_entries`, `payroll_entry_items`. `TRUNCATE_ALL` includes all but `payroll_settings` (seed row).
- **Decisions (change here if HR wants otherwise):** (1) all money is integer **minor units** in `bigint` (1 ETB = 100); rates are `numeric(7,4)` percents 0-100; (2) **nothing statutory is seeded** (no brackets, taxes or deductions); settings default to the spec's 5% / 10% pension; (3) **a bracket applies when from <= income < to** (`to_minor` exclusive, NULL = no upper limit): the DB refuses overlaps; **gaps / missing open-ended bracket are 4.5's job** (the UI can show To as "up to, not including"); (4) a salary profile has ONE allowance amount with two flags (taxable, pensionable) plus a per-employee `pension_applies`; (5) one-time deductions are consumed by setting `applied_period_id` when a payroll is generated (cleared if the draft period is deleted); recurring ones never are; (6) `payroll_settings` also holds `rounding_mode` (half_up default, half_even, down, up) and the two switches for absence / unpaid-leave deductions (4.15 decides the daily rate); (7) `payroll_entries` stores every amount PLUS the rates and the bracket's fixed deduction used and the employee code/name, so a payslip never reads a current setting; the DB repeats the spec 17 formulas as CHECKs (gross, net, employer cost); (8) `payroll_entry_items` holds the breakdown of Other Tax and Other Deductions (kinds incl. `absence`, `unpaid_leave`), no foreign keys to settings so deleting a setting never touches history; the sheet's Other Deductions = flat items + attendance items.
- **Immutability is in the database:** once a period is `approved`, triggers refuse any insert/update/delete on its entries and items, deleting the period, and every period change except approved -> paid. `config_snapshot` (jsonb) must be set at approval (CHECK). 4.13 therefore must finish writing entries BEFORE flipping the status; a draft period may be deleted with its entries (CASCADE).
## Money notes (task 4.2)
- `services/money.js`, **pure and fully tested here** (`tests/money.test.js`, 7 pass). Money = integer minor units (safe integers as plain Numbers); products are computed in BigInt and rounded ONCE.
- API: `percentOf(amountMinor, rate, mode)`, `divRound(n, d, mode)` (returns BigInt), `sumMinor(list)`, `rateToScaled(rate)`, `parseMoney('2,500.50') -> 250050` (strict, max 2 decimals, no floats), `formatMoney(250050) -> '2,500.50'`, `assertMinor`, `ROUNDING_MODES`, `MAX_MINOR` (= the DB ceiling 9,999,999,999,999).
- Rounding (matches `payroll_settings.rounding_mode`): `half_up` (default; halves away from zero), `half_even` (banker's), `down` (toward zero), `up` (away from zero). Rates accept up to 4 decimals (`numeric(7,4)`) as string or number, 0-100; anything else throws, never rounds silently. The engine (4.3) should call `percentOf` once per line item and never round a rounded value again.
- Not here on purpose: the tax formula `MAX(0, base x rate - fixed deduction)` and which base applies live in the engine (4.3).

## Auth notes
- Passwords: `bcryptjs` cost 12; policy = min 10 chars, max 72 bytes (rejected, never truncated). `verifyPassword(plain, null)` still runs a dummy compare so unknown emails take the same time (use in login, 1.8).
- Emails are stored trimmed + lowercased.
- Seed: `npm run seed` creates the first HR admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (/ SEED_ADMIN_NAME). Re-running changes nothing. `npm run seed -- --reset-password` is the lockout-recovery path (also revokes that user's sessions). Placeholder password refused in production. Both actions are audited without the password.
- Shared test helper `tests/helpers.js` sets the test env and the "DB name must contain test" guard.

## Session notes (task 1.6)
- `middleware/session.js`: `loadSession` (sets `req.session`/`req.user`, never rejects), `createSession`, `destroySession`, `destroyUserSessions`. Mounted after `/health` so uptime pings never query the DB; requests without a cookie cost no query.
- Cookie: HttpOnly, Path=/, SameSite from `COOKIE_SAMESITE` (default lax), Secure + `__Host-` prefix in production. DB stores only an HMAC (keyed by SESSION_SECRET) of the token. Fresh token on every login; previous session revoked (anti-fixation).
- Lifetimes: HR 12 h absolute / 2 h idle; employee 12 h absolute / 12 h idle. **Locked tablet sessions skip the idle check** (employees keep using them) but still hit the 12 h cap, so the tablet needs an HR login each working day. `last_seen_at` refreshed at most once a minute. Expired rows are cleaned on login (no cron).
- Deactivated users are rejected on their next request (checked via the join on users.is_active).
- **Deployment decision still open (needed by 5.4):** Render's static site and web service get different `*.onrender.com` origins, which are cross-site, so a SameSite=Lax cookie will not be sent. Options: (a) custom domain with sibling subdomains (app. / api.), (b) proxy `/api` through the static site, (c) `COOKIE_SAMESITE=none` (works, but Safari and some privacy settings block third-party cookies). (a) or (b) preferred.

## CSRF notes (task 1.7)
- `middleware/csrf.js`, mounted right after `loadSession`. Applies to POST/PUT/PATCH/DELETE only.
- Design change from the plan: **session-bound synchronizer token** (the `sessions.csrf_token` column) instead of a double-submit cookie; stronger, and needs no extra cookie. Client reads the token from the login response and `/me` (task 1.8) and sends it as `X-CSRF-Token`.
- Layer 1, Origin: a write with an Origin other than `FRONTEND_URL` (including `null`) gets 403 `csrf_origin`, even anonymous (this covers login CSRF). No Origin header = allowed here (curl/tests carry no browser cookies).
- Layer 2, token: if the request has a valid session, the header must match (timing-safe compare) or 403 `csrf`.
- Requests with no session pass the token layer; route-level `requireAuth` (1.9) rejects them.

## Login notes (task 1.8)
- Routes under `/api/auth`: `POST /login`, `POST /logout`, `GET /me`. All responses `Cache-Control: no-store`. All API routes will live under `/api` (frontend client in 1.11 must use that prefix).
- Login body validated inline (strings only, email <= 254, password <= 256) -> 400 otherwise; real validator arrives in 1.10 and may replace the inline checks.
- Same 401 `invalid_credentials` for unknown email, wrong password and deactivated account; a bcrypt compare always runs (dummy hash when no account).
- Throttle (`middleware/rateLimit.js`, in-memory, bounded): failures only, 5 per email+IP and 20 per IP per 15 min; blocked requests get 429 + `Retry-After` and are not verified at all (even a correct password). Success resets the email+IP counter. Client IP comes from `X-Forwarded-For` via `trust proxy 1`. Counters reset on restart (single instance assumed). `createLimiter` is reusable for the unlock limiter in 2.3.
- Known trade-off: no account-wide cap across all IPs, so a distributed guess cannot lock out the HR admin; bcrypt cost 12 + 10-char minimum is the defence there.
- `/me` returns `{user, csrfToken, locked}` so the SPA can restore state after reload.
- `wrap()` in error.js is the async route wrapper. Login and logout are audited (see Guards and audit notes); failed logins are deliberately not written to the audit table.

## Guards and audit notes (task 1.9)
- `middleware/auth.js`: `requireAuth`, `requireRole(roles, {allowLocked})`, `requireHr`, `requireEmployee`. Check order: 401 not signed in -> 403 wrong role -> 423 `screen_locked`.
- **Default-deny lock:** a locked HR session is refused by every `requireHr`/`requireRole` route unless the route opts in with `{ allowLocked: true }`. Task 2.2 adds the global allowlist middleware as a second layer; use `allowLocked` only for QR display/generate, session state, unlock and logout. `requireAuth` alone does not check the lock, so admin routes must use the role guards.
- Employees see 403 (not 423) on HR routes, so lock state is not leaked to them.
- `services/audit.js`: `audit(db, {actorId, action, entityType, entityId, reason, details})`. Pass the transaction client as `db` so the audit row commits/rolls back with the change. Secret-looking keys (password, token, secret, hash, csrf, authorization, cookie, session) are redacted recursively; details over 8 KB become `{truncated:true}`.
- Audited so far: `auth.login` (with role + IP), `auth.logout`, `user.create`, `user.password_reset` (seed script).
- Integer ids come back from pg as strings (bigint); compare with `String()`/`Number()` in tests.

## Validation notes (task 1.14)
- `middleware/validate.js`: `validate(schema, source='body')` middleware, `parse(schema, data, {coerce})` pure function, and `v` rule builders: `v.string/email/int/number/boolean/enum/date/time({required, nullable, default, min, max, ...})`.
- Failure -> 400 `validation` with `error.details.fields = { field: message }` (all fields reported at once; non-object body -> `fields._`).
- Success replaces `req[source]` with a **cleaned copy**: only schema keys (unknown keys dropped, so no mass assignment), strings trimmed, typed values. Handlers must read from `req.body` / `req.query` after the middleware, never from the raw input.
- Strings default to max 255 chars (override with `max`); email is lowercased and max 254. Blank/whitespace-only = missing. `null` is accepted only with `nullable: true`; otherwise treated as omitted (or "Required").
- Bodies are strict (`"5"` is not an int); query strings (`source='query'`) are coerced ("5" -> 5, "true" -> true). Repeated query params arrive as arrays and are rejected.
- Dates are real calendar dates (`YYYY-MM-DD`); times are `HH:MM` 24 h. Money/decimal type is deliberately not here: add it with the payroll tasks (Phase 4), as integer minor units.
- Login still uses its inline checks (works, tested); switching it to `validate` is optional cleanup.
- **Not yet run in full:** `tests/validate.test.js` has 10 pure tests (all pass) and 4 HTTP tests via supertest. This session's sandbox had no `node_modules` and no network, so the HTTP tests were not run; run `npm test` after `npm install`.

## Frontend shell notes (task 1.14)
- Files: `frontend/index.html`, `vite.config.js` (port 5173, `strictPort` because CORS/CSRF Origin allow exactly `FRONTEND_URL`), `src/main.jsx`, `src/App.jsx`, `src/api/client.js`, `src/api/auth.jsx`.
- `api/client.js`: `api/get/post/put/patch/del` under `/api`, `credentials: 'include'`, JSON in/out. `X-CSRF-Token` is added on POST/PUT/PATCH/DELETE once a token is known (held in memory only; re-learned from `/auth/me` after a reload). Failures throw `ApiError {status, code, message, details}`; `e.fields` gives the validation messages per field; network failure is status 0 / code `network`; `AbortError` passes through; 204 returns `null`.
- Base URL = `VITE_API_URL` (dev: `http://localhost:4000`); empty = same origin (use that if `/api` is proxied through the static site, deployment option b).
- Session events: a 401 `unauthenticated` clears the user (-> login screen); a 423 `screen_locked` sets `locked` in the auth context. A wrong password (401 `invalid_credentials`) does neither.
- `AuthProvider` / `useAuth()`: `{status: loading|ready|error, user, locked, error, login(email,pw), logout(), reload()}`. `/me` on load; an unreachable server shows a retry screen instead of the login form. `logout()` clears local state even if the request fails. `homePath(user)`: hr -> `/hr`, employee -> `/portal`.
- `App.jsx` routes: `/` (redirect), `/login`, `/hr/*` (role hr), `/portal/*` (role employee), `*` -> `/`. `RequireRole` redirects anonymous users to `/login` with `state.from` (path + query) so the login page can return people to a scanned QR link; wrong role -> own home. This is UI convenience only; the server enforces roles and the lock.
- Page bodies are placeholders until 1.12 (Login), 1.14 (HrLayout), 1.16 (PortalLayout). No stylesheet yet (task 1.13 creates `styles.css` and imports it in `main.jsx`).
- `npm test` at the root now runs backend and frontend tests; frontend tests use `node --test` with a mocked `fetch`.
- **Not verified in the sandbox:** no `node_modules` and no network, so `vite build`/`npm run dev` and the React components were not run. Only `client.js` (8 tests, pass) and a JSX syntax check of the three `.jsx` files were done. First thing next session on a machine with network: `npm install`, `npm run build`, open the dev server and confirm `/` redirects to `/login`.

## Login page notes (task 1.14)
- `pages/Login.jsx`: email + password form (show/hide password via lucide Eye/EyeOff), client check for empty fields, double-submit guard, `aria-invalid`/`role="alert"`, browser-friendly autocomplete (`username` / `current-password`). Password is never trimmed or stored; it is cleared after a 401/429.
- Error messages: 401 shows the server's single generic message (never says which field was wrong); 429 shows "Try again in N minute(s)" from `retryAfterSeconds`; validation errors are shown per field; network errors show the client's "Cannot reach the server" text.
- Redirect after login is **not** done in the form: `LoginRoute` in `App.jsx` redirects as soon as a user exists (also when an already-signed-in person opens `/login`), to `redirectTarget(location.state.from, user)`.
- `api/paths.js` (pure, tested): `homePath(user)` and `redirectTarget(from, user)`. A saved `from` is honoured only if it is a same-app path inside the user's own area (`/hr...` for HR, `/portal...` for employees); `//host`, `https://`, backslashes, control chars, look-alike prefixes (`/hrx`), `/login` and over-long values fall back to the role's home. `homePath` moved here from `api/auth.jsx`.
- Class names used by the page for task 1.13 to style: `auth-page`, `auth-card`, `muted`, `form-error`, `field`, `field-error`, `password-row`, `icon-btn`, `btn primary`. Until 1.13 adds `styles.css` the page renders unstyled.
- **Not verified in the sandbox (no node_modules/network):** the components were syntax-checked only and never rendered. `paths.js` has 6 tests (all pass; frontend total 14). Manual check on a machine with network: seed an admin and an employee, log in as each, confirm HR lands on `/hr`, the employee on `/portal`, a wrong password shows the generic message, and the 6th wrong attempt shows the "try again in 15 minutes" text.

## Shared components and theme notes (task 1.14)
- `styles.css`: colour tokens as CSS variables. Dark is the default (`:root`), light via `<html data-theme="light">`. The theme is applied before first paint by an inline script in `index.html` (no flash); choice stored in `localStorage['natra-theme']` (guarded, works with storage blocked). Tokens: `--bg --bg-sidebar --surface --surface-2 --border --input-bg --input-border --text --muted --accent --on-accent --danger --warn --ok`. Use these, never hard-coded colours. Status colours are always paired with text (badges), never colour alone.
- **Contrast is tested:** `tests/theme.test.js` parses `styles.css` and checks WCAG AA (4.5:1 text, 3:1 control borders) for both themes; mutation-checked (a low-contrast token makes it fail). Changing a colour token re-runs this check.
- Components in `src/components/`: `Button` (variants default/primary/danger, `size="sm"`, `busy` disables + spinner, defaults to `type="button"`), `Field` (`as` input/select/textarea, label, hint, `error` wired to `aria-invalid`/`aria-describedby`), `Modal` (portal, focus moves in and returns to opener, Tab trap, Esc/backdrop close, scroll lock, `dismissible={false}` for must-answer dialogs such as the QR unlock), `Table` + `Badge` + `Pager`, `ToastProvider`/`useToast()` (`toast.success/error/info`; max 4; errors last 7 s and use `role="alert"`), `ThemeToggle`.
- `Table` props: `columns [{key, header, render?, align:'num', className}]`, `rows`, `rowKey`, `caption`, `loading`, `error` + `onRetry`, `empty`, `onRowClick`. Use `className: 'nowrap'` for codes/dates. Scrolls sideways inside its own wrapper, never the page.
- **List contract proposed for 1.15:** API returns `{ items, page, pageSize, total }`; `Pager` takes `page, pageSize, total, onPage`; `pageInfo()` in `components/pagination.js` does the maths and clamps bad input.
- `main.jsx` now imports `styles.css` and wraps the app in `ToastProvider`. Login page now picks up its styles (`auth-page`, `auth-card`, ...).
- Touch targets: 40 px on mouse devices, 46 px on touch (`pointer: coarse`).
- **Verified in a real browser (Chromium via Playwright) this session:** a showcase page built from the actual component files rendered in dark and light; dialog focus trap, Esc/backdrop close, focus return, scroll lock, toasts (+ dismiss), theme toggle + persistence across reload, login-form error and empty-field messages, no console errors, no horizontal page scroll at 375 px, 46 px tap targets on a touch viewport. `lucide-react` was replaced by simple stub icons in that harness (not installed, no network) and the harness lives outside the repo, so the real icons and `vite build` are still unchecked. Frontend suite: 21 tests pass.

## HR layout notes (task 1.14)
- `components/HrLayout.jsx`: top bar (brand, clock, theme toggle, user chip with initials + "HR Administrator"), sidebar, `<Outlet/>`. Sidebar = the 7 spec §4 items in order (data in `components/hrNav.js`, tested) plus a separate red **Log out** button. Active item gets the accent bar; Dashboard uses `end` so it is active only on `/hr` exactly.
- Routing in `App.jsx`: `/hr` is `RequireRole('hr') > HrLayout`, with nested routes `index, employees, attendance, qr, leave, payroll, settings` (placeholders until their tasks) and `*` -> `/hr`. An employee opening any `/hr...` URL is redirected to `/portal` by `RequireRole`; anonymous users go to `/login` with `from` saved. **To add a page:** replace that route's `Placeholder` element; page components render a `<section>` with an `<h1>` (the layout already provides the single `<main>` landmark).
- **Locked tablet (§6.1):** when `/auth/me` says `locked`, the layout renders no sidebar/top bar, just `<div class="locked-shell"><Outlet/></div>`, and any `/hr/*` path other than `/hr/qr` is redirected to `/hr/qr` (`isQrPath`). It survives refresh because the lock comes from the server session. Task 2.x supplies the real QR page and unlock dialog; the UI side is ready. The server remains the authority (default-deny lock in `requireHr`).
- Phone/tablet (<= 900 px): sidebar becomes an off-canvas drawer opened by the menu button (`aria-expanded`/`aria-controls`); closes on navigation, Esc, or scrim tap; hidden drawer is `visibility:hidden` so it cannot be tabbed into. Clock and name hidden under 700 px.
- A11y: skip-to-content link, `nav aria-label="Main"`, `aria-current="page"` from NavLink, `<time>` element for the clock. Clock is display-only: device locale/time zone, refreshed every 30 s, no API calls.
- **Verified in Chromium (real components, router and auth replaced by small stand-ins since react-router-dom is not installed here):** 7 items in order, Log out separate and calls `logout()`, active-item rule, skip link first in tab order, one `<main>`, dark + light desktop, drawer open/close by menu/nav tap/Esc/scrim at 390 px with no sideways scroll, locked mode hides all chrome and bounces `/hr/employees` back to `/hr/qr`, unlock restores the shell, no console errors. **Not verified:** real react-router behaviour (nested routes, `NavLink end`, `Navigate`) and `vite build`; confirm on a machine with network: log in as HR, click through all 7 items, open `/hr/foo` (-> `/hr`), log in as an employee and open `/hr` (-> `/portal`). Frontend suite: 27 tests pass.

## Employees, departments, shifts API notes (task 1.15)
- All under `/api`, all `requireHr` (default-deny lock: a locked tablet gets 423) and `Cache-Control: no-store`. Employees get 403, anonymous 401.
- **List contract (all three):** `GET ?page=1&pageSize=25` (pageSize max 100) -> `{ items, page, pageSize, total }`; a page past the end returns `items: []` with the real `total`. Employees also take `search` (name, email or code; case-insensitive; `%` and `_` match literally), `status` (active|inactive), `departmentId`, `shiftId`; sorted by name. Dropdowns can ask for `pageSize=100`.
- **Employees:** `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/deactivate`, `POST /:id/activate`. **There is no DELETE** (history must survive). Record shape: `{ id, employeeCode, userId, fullName, email, phone, departmentId, departmentName, jobTitle, startDate (YYYY-MM-DD), employmentType, status, shiftId, shiftName, createdAt }`. Salary is not here (salary_profiles arrives in 4.1/4.10).
- **Create** makes the login (`users`, role `employee`) and the employee row in one transaction. HR sets the initial password in the body (`password`, policy from services/password.js, never trimmed, never returned or audited). `shiftId` omitted = the first shift; no shifts at all -> 400 on `shiftId`. `role`, `status`, `userId` in the body are ignored.
- **PATCH is partial:** omitted = unchanged; `null` clears `phone`, `departmentId`, `jobTitle`; a blank string counts as omitted. Editable: employeeCode, fullName, email, phone, departmentId, jobTitle, startDate, employmentType, shiftId. Status and password are not editable here. An empty change set is 400; an update that changes nothing returns the record and writes no audit row.
- **Deactivate / activate:** idempotent; optional `reason` (audit only). Deactivating sets `employees.status` and `users.is_active` and deletes that person's sessions in the same transaction, so they are signed out at once and cannot log in. Email and employee ID stay reserved while inactive.
- **Departments / shifts:** `GET / POST / PATCH /:id / DELETE /:id`. Each row carries `employeeCount`. DELETE works only when unused (409 `in_use` otherwise, relying on the RESTRICT foreign keys, so inactive employees count). Shifts: `{ id, name, startTime 'HH:MM', endTime, graceMinutes 0-240, workDays [ISO 1-7, sorted], employeeCount }`; create defaults are grace 0, Mon-Fri; `end > start` is enforced by the DB CHECK and reported as 400 on `endTime` (also when a PATCH alone would invert the pair).
- **Errors:** field problems are 400 `validation` with `details.fields`; duplicate email / employee ID / department name / shift name (case-insensitive) are 409 `conflict` with `details.fields` naming the field; unknown department/shift reference is 400 on that field; unknown id 404 `not_found`; malformed id 400. Mapping lives in `services/dbErrors.js` (keyed by constraint names in migration 001, so renaming a constraint needs an edit there).
- **Audit actions:** `employee.create|update|activate|deactivate`, `department.create|update|delete`, `shift.create|update|delete`; updates store `details.changes = { field: { from, to } }`.
- **New shared pieces:** `validate.js` gained `v.intList({min,max,minItems,maxItems})` (sorted, unique); `audit.js` gained `diffFields`; `services/sql.js` (`pageSchema`, `pageOffset`, `pageResult`, `likePattern`, `setClause`: column names come from a whitelist, never from the request); `services/hrSchemas.js` (all request schemas, no Express/pg imports so they are unit-testable); `middleware/noStore.js`.
- **Not verified in the sandbox (no node_modules, no Postgres, no network):** the SQL and the HTTP behaviour have never been executed. Verified: all files pass `node --check`; the three routers import cleanly (checked with throwaway stubs for express/pg/bcryptjs, since removed) and register the intended routes; `tests/hrSchemas.test.js` (14 pure tests) passes. `tests/employees.test.js` and `tests/orgstructure.test.js` (33 tests) were written but not run. **First thing next session on a machine with Postgres:** `npm install`, set `TEST_DATABASE_URL`, run `npm test`, and fix whatever the SQL tests find.
- Not built (out of 1.15's "done when"): HR password reset for an employee, and a "view attendance + leave history" endpoint (§9) which arrive with Phases 2 and 3.

## Employees page and portal shell notes (task 1.16)
- **Employees page** (`pages/Employees.jsx`, route `/hr/employees`): search (debounced 300 ms; name, email or ID), department and status filters, 20 per page with the shared `Pager`, loading/error/empty states, Add / Edit / Deactivate / Activate per row. Changing a filter returns to page 1. Dropdown data comes from `/departments` and `/shifts` with `pageSize=100`. "Add employee" is disabled (with a hint) until at least one shift exists.
- **Form dialog** (`pages/EmployeeDialog.jsx`): one dialog for add and edit, remounted per employee (`key`). Add sends the full body incl. the initial password (never trimmed); edit sends **only changed fields**, and a blank phone / title / department becomes `null` (clear). Saving with no change just closes. Server 400/409 field errors show under the matching inputs. Deactivate opens a confirm dialog with an optional reason; Activate is one click.
- **Pure helpers** (`pages/employeeForm.js`, tested): `validateForm`, `buildCreate`, `buildPatch`. Client rules mirror the server (code and phone patterns, password 10+ chars and 72 bytes) and only save a round trip.
- **Portal shell** (`pages/portal/PortalLayout.jsx`, `portalNav.js`): `/portal` is `RequireRole('employee') > PortalLayout` with nested routes `index` (PortalHome: greeting + "scan the office QR" card), `attendance`, `leave`, `payslips` (placeholders until 2.19, 3.5, 4.20) and `*` -> `/portal`. Phone-first: compact top bar (theme toggle, log out), fixed **bottom tab bar** (touch targets from `--tap`, safe-area insets), content capped at 720 px on wide screens.
- **To add a portal page:** replace that route's `Placeholder`; render a `<section>` with an `<h1>` (the layout provides the single `<main>`).
- **Not verified (no node_modules, network or Postgres in the sandbox):** the React components were only syntax-checked (TypeScript transpile) and never rendered; `vite build`, the real router/icons and the live API are unchecked. Frontend suite: 33 tests pass (6 new). **Manual check on a machine with network:** log in as HR, add an employee (try a duplicate email and a short password), edit, deactivate with a reason, activate, search/filter/page; then log in as that employee in a phone-width window and click the four tabs.

## Auth and role-isolation test notes (task 1.17)
- Login tests (1.8) were already in `tests/auth.test.js`; 1.17 added **spec §26 test 1** to the same file.
- **Structural guard test:** `GUARD` (a symbol exported by `middleware/auth.js`) tags `requireAuth` and everything `requireRole` returns. The test walks the Express router stack and fails if any mounted router other than `/api/auth` lacks a guard before its first route. **Consequence for later tasks:** every new router must start with `router.use(requireHr)` / `requireEmployee` / `requireRole(...)` / `requireAuth` (or per-route guards would not satisfy it; keep the router-level `use`). The QR scan router (2.12) should use `requireEmployee` at router level.
- **Behaviour tests:** an employee (with a real record) gets 403 `forbidden` on all 16 method/path combinations across employees, departments and shifts (including their own record and another employee's), anonymous gets 401, refused writes change nothing, and no data leaks in the error body; claiming a role by query, header or login body does not elevate; a made-up cookie is 401 and logout ends access immediately; HR still gets 200 on the same GETs.
- **Gap, deliberately recorded as `test.todo`:** "another employee's salary". Salary endpoints do not exist until 4.1/4.10; add the isolation cases then (employee 403 on salary routes, 404 for another employee's payslip). Task 5.1 should confirm test 1 is complete once Phase 4 lands.
- **Not run:** like the other DB-backed suites, these need Postgres (`TEST_DATABASE_URL`). Only `node --check`, a check that the guard marker is present on `requireHr`/`requireAuth`/`requireRole(...)`, and the pure suites were run here.

## Leave request API notes (task 3.3)
- Files: `routes/leave.js` (employee router, mounted at `/api/leave`, `requireEmployee` at router level so the guard-walk test passes), `services/leave.js` (rules shared with 3.4/3.8), schemas appended to `hrSchemas.js` (`leaveRequestBody`, `leaveBalanceQuery`, `myLeaveQuery`, `LEAVE_STATUSES`).
- **Routing decision:** HR decisions (3.4) go in a **separate** router `routes/leaveAdmin.js` mounted at `/api/leave-requests` (same split as `/api/attendance` vs `/api/attendance-records`), because one router cannot be guarded for both roles. The plan's "Open: routes/leave.js" for 3.4 is superseded by this.
- Endpoints (all `no-store`, employee = the signed-in user, never taken from the request): `GET /types`; `GET /balances?year=` (default: current year in company timezone) -> `{year, items}` one per type; `GET /requests?page&pageSize&status&year` newest first; `POST /requests {leaveTypeId,startDate,endDate,reason}` -> 201 pending request; `POST /requests/:id/cancel`.
- **Balance rule (decision):** `remaining = entitled + adjusted - used(approved) - pending`, per calendar year. **No `leave_balances` row = the type's `default_days`** (computed, nothing written on GET). 3.4's adjust/entitlement endpoint must therefore **upsert** the row, seeding `entitled_days` from `default_days` when it creates it. Types with `has_balance = false` (unpaid) are never limited and report `remaining: null`.
- **Days** are counted server-side with `workingDaysForEmployee` (shift work days minus holidays); a `days` sent by the client is ignored (schema drops unknown keys). 0 working days -> 400 on `startDate`. Range must be ordered and inside one calendar year (400 on `endDate`).
- **Overlap:** a request is refused (409 `leave_overlap`, `details.fields.startDate`) if it overlaps the same person's **pending or approved** leave of any type; cancelled/rejected do not block. The DB exclusion constraint still guarantees no overlapping *approved* leave when HR approves (3.4 must translate SQLSTATE `23P01` to a 409).
- **Balance check:** 409 `insufficient_balance` (`details.fields.leaveTypeId`, `details.remaining`, `details.requested`). Pending requests count against the balance.
- **Concurrency:** the employee row is locked (`SELECT ... FOR UPDATE`) at the start of the create transaction, so one person's simultaneous requests are checked one after the other. Mutation-checked: removing the lock makes the concurrency test fail 3/3.
- **Cancel:** employee, own **pending** only (409 `not_pending` otherwise; someone else's id is 404, same as missing). Cancelling an *approved* request is not in the MVP (HR would have to reverse it; not specified).
- Audited: `leave.request`, `leave.cancel` (entity `leave_request`).
- Inactive employee or user without an employee record -> 403 `employee_inactive` / `no_employee_record` (same as scan).
- Tests: `tests/leave.test.js` (2 pure + 11 DB). 3.9 should extend this file with the HR decision and attendance cases.
- Fixed two **pre-existing test bugs** found on the first real Postgres run this session (neither was a product bug): `schema.test.js` expected constraint name `leave_types_default_days_check` (Postgres auto-names that inline CHECK `leave_types_check`); `attendance.test.js` #11 counted every `attendance.photo_view` audit row, including earlier tests' (audit_logs is append-only and cannot be cleared), so it now filters by this record's id.

## HR leave API notes (task 3.4)
- `routes/leaveAdmin.js`, mounted at **`/api/leave-admin`** (supersedes the `/api/leave-requests` name in the 3.3 notes), `requireHr` at router level (locked tablet -> 423, employee -> 403). Logic is in `services/leave.js` (`decideLeaveRequest`, `changeBalance`).
- `GET /requests?page&pageSize&status&year&employeeId&departmentId`: all employees, **pending first**, then newest; each item adds `employeeId, employeeCode, employeeName`.
- `POST /requests/:id/approve {remarks?}` and `POST /requests/:id/reject {remarks}` (remarks required, min 3). Only `pending` can be decided (409 `not_pending`; also for cancelled). Sets `decided_by_user_id`, `decided_at`, `decision_remarks`; audit `leave.approve` / `leave.reject` with the remarks as the reason. The employee's own list shows the remarks. The employee row is locked first (same order as request creation), so decisions and new requests for one person never interleave.
- **Overlap on approve:** friendly pre-check, plus SQLSTATE `23P01` from the exclusion constraint mapped to 409 `leave_overlap`. Tested with two simultaneous approvals: exactly one wins.
- `GET /balances?employeeId&year` (employeeId required) -> same shape as the employee endpoint.
- `POST /balances {employeeId, leaveTypeId, year, entitledDays?, adjustDays?, reason}` -> updated balance. `entitledDays` is **set** (absolute); `adjustDays` is a signed **change** added to HR's adjustment. At least one is required; **reason is mandatory** (min 3) and stored in the audit row (`leave.balance_adjust`, entity id `employee:type:year`, details hold before/after). Upsert: a missing row is created from the type's `default_days`. Refused: unpaid (no balance), unknown employee/type, negative total (400), total below approved + pending days (409 `below_used`).
- Not built (not in spec): editing leave types, HR creating a request on behalf of an employee, reversing an approved request.
- Tests: `tests/leaveAdmin.test.js` (8 DB tests). Full backend suite 323 pass / 0 fail / 1 todo.

## Employee leave page notes (task 3.5)
- `pages/portal/Leave.jsx` (route `/portal/leave`, replaces the placeholder) and pure helpers in `pages/portal/leaveView.js` (tested). New CSS: `.leave-balances`, `.leave-headline`, `.leave-empty`, and `.toolbar-2` is now top-aligned.
- Shows: year selector (server's current year +/- 1), one balance card per leave type ("11 of 16 days left", used / pending / HR adjustment; unpaid = "No limit"; a card turns warning-coloured at 0 left), the request form (type, from, to, reason), and "My requests" (10 per page, status as text + colour, HR remarks under the status, **Cancel** on pending rows with a confirm dialog).
- The form never shows or sends a day count: the server counts working days and checks overlap/balance. Client rules only cover the cheap checks (type, dates in order, one calendar year, reason >= 3). Server field errors (`leave_overlap` -> From, `insufficient_balance` -> Leave type) appear under the matching input; other errors appear at the top of the form. Choosing From fills To with the same day.
- **Verified in real Chromium against the real API + Postgres** (phone viewport 390 px): balance cards from the server, client validation messages, request created (Mon 2 - Fri 6 Nov = 5 days, pending, balance 16 -> 11), overlap refused with the server message under From, cancel via the dialog (balance back to 16), no horizontal page scroll, no unexpected console errors. Throwaway harness lived in /tmp, not the repo. Not checked: light theme and desktop width on this page, and an HR approval changing what the employee sees (the HR page is 3.6).
- Tests: `tests/leaveView.test.js` (8). Frontend 74 pass; `vite build` OK.

## HR leave page notes (task 3.6)
- Files: `pages/Leave.jsx` (route `/hr/leave`, replaces the placeholder), `pages/LeaveDialogs.jsx` (`DecisionDialog`, `EntitlementDialog`), pure helpers in `pages/leaveAdminView.js`; CSS adds only `.toolbar-4`. Uses the existing 3.4 API unchanged (`/api/leave-admin/requests|approve|reject|balances`); **no backend change**.
- Two sections switched by buttons (`aria-pressed`): **Requests** and **Entitlements**.
- **Requests:** the server already lists pending first; the page defaults the Status filter to *Pending* so it opens as an approval queue. Filters: status, employee, department, year (device year +/- 1, display only); "Reset filters". Each pending row has Approve and Reject. Both open a dialog showing employee, type, dates, days and the employee's reason. **Approve:** optional note. **Reject:** reason required (>= 3 chars, the employee sees it; mirrors the DB CHECK). A `not_pending` 409 (someone else decided it first) shows a toast and refreshes the list instead of a dead dialog. Overlap (`leave_overlap`, 409) is shown in the dialog.
- **Entitlements:** choose an employee (first 100 active-or-not employees, same lookup as the attendance page) and a year; table per leave type: entitlement, HR adjustment, used, pending, left. **Change** opens a dialog: *Set yearly entitlement* (absolute) and/or *Add or remove days* (signed change), both whole days, plus a required reason (kept in the audit log). A live line previews the new total/left. The server stays the authority (it refuses a total below approved + pending days, `below_used`, and negative totals; messages are shown in the dialog). Unpaid has no balance, so it has no Change button.
- Approving shows nothing about balances on this page except through the Entitlements table: **"Approve/reject updates balances" (done-when) is true on the server** (used/pending are computed from requests), and the table reloads from the server after each save.
- Tests: `tests/leaveAdminView.test.js` (9 pure tests: queue rows, reject needs a reason, blank-vs-zero entitlement, signed adjustment, preview maths, error mapping). Frontend 83 pass.
- **NOT verified:** the page was **not built with Vite and not rendered in a browser** this session (the frontend install was partial and the network is blocked, so no Vite/esbuild). JSX syntax was checked with `tsc` only. **First thing with network: `npm install && npm run build`, then open `/hr/leave` against the live API** (approve a pending request from the employee portal, reject one, change an entitlement) and check phone width and the light theme.
- Not built (not in spec): HR creating a request on behalf of an employee, reversing an approved request, editing leave types, department-wide entitlement changes.

## Holidays and working-day settings notes (task 3.7)
- **Backend:** `routes/settings.js`, mounted at **`/api/settings`**, `requireHr` at router level (locked tablet -> 423). Holidays only (payroll settings join this router in Phase 4): `GET /holidays?year=` -> `{year, items}` for one calendar year by date (default: current year in the company time zone); `POST /holidays {date, name}` -> 201; `PATCH /holidays/:id {date?, name?}`; `DELETE /holidays/:id` -> 204. A holiday is a setting, not history, so delete is a real delete; leave requests keep their own `days` snapshot (3.1 decision), so **a holiday change only affects requests made afterwards**. Audited: `holiday.create|update|delete` (update stores from/to). Dates 2000-2100 (same window as leave); one holiday per date (`holidays_date_key` -> 409 on `date`, mapped in `dbErrors.js`). Schemas in `hrSchemas.js` (`holidayCreate`, `holidayUpdate`, `holidayListQuery`).
- **Working days are the shifts API, not a new table:** the schedule (work days, hours, grace) already lives on `shifts` and is what `workdays.js` and the late rule read, so the Settings page edits shifts through `/api/shifts` (no `/api/settings/working-days`). **Decision:** one schedule per employee, no company-wide default weekday list.
- **Frontend:** `pages/Settings.jsx` (route `/hr/settings`, replaces the placeholder) with two sections. **Holidays:** year selector, table, Add/Edit dialog, Delete with confirm (saving into another year switches the list to that year). **Working schedules:** table of shifts (work days as "Mon-Fri", hours, grace, head count), Add/Edit dialog with weekday checkboxes (no Delete: not in the plan, and the API refuses deleting a shift in use). This also fixes the Employees page hint "Create a shift first (Settings)", which had nowhere to go. Dialogs in `SettingsDialogs.jsx`; pure helpers in `settingsView.js`; CSS adds `.weekdays`.
- Shift rules shown to HR: end must be after start (same-day shifts only, MVP), grace 0-240, at least one work day.
- **Tests:** `backend/tests/settings.test.js` (6 DB tests: guards/423, create+list by year, duplicates and invalid input, update with audit, delete, and the done-when test: a holiday added/moved/deleted and a shift's work days changed alter the day count of the next request, while an existing request keeps its days) **written, NOT run (no Postgres)**; 1 pure schema test added to `hrSchemas.test.js` (15 pass here); settings routes added to the employee-403 walk in `auth.test.js`; `frontend/tests/settingsView.test.js` (7). Frontend 90 pass.
- **NOT verified:** same as 3.6: no Vite build and no browser render (JSX syntax-checked with `tsc` only), and no Postgres. **First thing with network + a DB: `npm test` in backend (the settings and leave suites), `npm run build` in frontend, then open `/hr/settings` and `/hr/leave`.**
- Not built: bank-holiday presets/import, recurring holidays, per-department holidays, half-day holidays, deleting schedules.

## Other taxes API notes (task 4.7)
- Same router as 4.5/4.6 (`routes/payrollSettings.js`, `/api/payroll-settings`, HR only, locked tablet 423). **`GET /other-taxes`** -> `{items:[{id,name,rate,base,enabled}], bases}` (items by name; `bases` = the fixed dropdown list `gross | basic | taxable_income | pensionable`, the engine's `OTHER_TAX_BASES`). **`POST`** `{name, rate, base, enabled?}` -> 201 (enabled defaults true). **`PATCH /:id`** partial (omitted = unchanged, unknown keys dropped, empty body 400 on `_`, a no-change request returns 200 and writes no audit row). **`DELETE /:id`** -> 204.
- **Predefined bases only (done-when):** `base` must be one of the four values, anything else (including a formula string, wrong case, null) is 400 on `base` and the whole request saves nothing. A pure test reads `004_payroll.sql` and fails if the DB CHECK list and `OTHER_TAX_BASES` ever differ.
- Rate 0-100, at most 4 decimals (same rule as pension); name 1-100 chars, unique case-insensitively (index `other_taxes_name_key` -> 409 `conflict` on `name`, mapped in `dbErrors.js`). Renaming a tax to itself in another case is allowed.
- **Delete is a real delete** (decision): a tax is a setting; payroll entries/items and the approval snapshot keep their own copies (migration 004 has no foreign keys to this table), so history is untouched. To pause a tax without losing it, PATCH `enabled: false` (the engine skips disabled taxes). Audit actions `payroll.other_tax.create|update|delete` (update stores `changes {field:{from,to}}`, delete stores the old values).
- `loadOtherTaxes(db)` and `toOtherTax(row)` are exported and return the exact `otherTaxes` shape `payrollEngine.computeEntry` reads: **4.11/4.12 should call `loadOtherTaxes` inside the generation transaction**, and 4.13 snapshots the whole list (disabled ones included). Changes only affect drafts.
- Tests: `tests/payrollSchemas.test.js` +6 pure (create/update shapes, unknown base, required fields, DB-CHECK drift guard, accepted body computes in the engine) pass. `tests/payrollSettings.test.js` +6 DB tests (guards, CRUD + audit, unknown base saves nothing, field errors + case-insensitive duplicate 409, 404/400 ids + no-op + mass assignment, `loadOtherTaxes` into `computeEntry`) and the four routes in `auth.test.js`'s employee-403 walk: **NOT RUN (no Postgres; node_modules absent and the registry is unreachable this session)**; the route file passes `node --check` but could not be imported (express/pg not installed).
- Not here: the Other Taxes tab UI (4.9), per-employee exemptions (not in spec).

## Deduction hookup notes (task 4.8b, in progress)
- `services/deductions.js` is the home of everything the generation transaction (4.11, 4.15) needs from items. Done so far: `toDeduction(row)`, `toEngineDeduction(item)` (4.8b-1), `loadDeductions` (4.8b-2) `consumeOneTimeDeductions` (4.8b-3, throws 409 `conflict` when the updated row count differs from the id count) and `assertNotConsumed` (4.8b-4, shared by PATCH and DELETE). The db client is passed in (no direct `pg` import); the only import is `HttpError`.
- `toDeduction` moved here from `routes/deductions.js` to avoid a route <-> service import cycle. Pure tests for the service live in `tests/deductionsService.test.js` (separate from the DB tests in `tests/deductions.test.js`, which skip without Postgres).
- Plan for the remaining subtasks: 409 for PATCH/DELETE of a consumed item is checked inside the `FOR UPDATE` section and before the diff; `consumeOneTimeDeductions` throws when it updates fewer rows than ids (a race or a recurring id) so the generation transaction rolls back; `loadDeductions(..., {lock: true})` locks the rows so two generations cannot take the same one-time item.

## Open questions / blockers
- **LOC (cloc, 2026-10-28, after 3.3): 7,678 code lines** (JS 6,052, JSX 1,223, SQL 205, CSS 198) vs target 7,000 / ceiling 9,000, with the rest of Phase 3, Phase 4 (~2,000 planned) and Phase 5 still to build. At the current rate the ceiling will be exceeded. **Decision needed from you:** raise the ceiling, or trim test depth / scope in Phase 4 (e.g. skip the SVG dashboard charts, ~150 LOC).
- **LOC watch:** Phase 1 finished at ~4,500 lines against a ~1,050 estimate. About 45% is tests (1,802), which the budget names as the first priority for headroom, but the plan total (~5,760) will not hold at this rate. Decide before Phase 2 whether to keep the current test depth or trim; the 9,000 ceiling is still safe if Phases 2-5 average well under the Phase 1 rate.
- Salary-sheet screenshot not yet supplied → payroll table (4.16) follows the 9-column list in spec §11 until it is.
- Original spec exists only as a digest (`references/spec-digest.md`).

## Session log
| Date | Work done | Tasks completed | Next |
|---|---|---|---|
| 2026-10-28 | 4.9-6: new `pages/OtherTaxesTab.jsx` wired into `PayrollSettings.jsx`: table (name, rate of base, Active/Paused badge), Pause/Resume (PATCH `enabled`), Add/Edit dialog (name, rate, base picked from the server's `bases`, active checkbox; validation from `validateOtherTax`, edit sends changed keys only, no-change edit refused with a message, server field errors incl. 409 duplicate name shown on the field), Delete with confirm text (approved payroll unaffected, suggests Pause); no new pure code, so no new tests (frontend 108 pass); **not built/rendered (no Vite), JSX syntax-checked with tsc only** | 4.9-6 (4.9 still open) | 4.9-7 |
| 2026-10-28 | 4.9-5: new `pages/PensionTab.jsx` wired into `PayrollSettings.jsx`: employee/company rate fields and pensionable-base select from `calcForm`/`validateCalcForm`, errors shown after the first Save, Save sends only changed keys via PATCH `/calculation` (`buildCalcPatch`; tax base is carried unchanged and never sent), server 400 field errors shown on the fields, no-change save says nothing to save, Discard; no new pure code, so no new tests (frontend 108 pass); **not built/rendered (no Vite), JSX syntax-checked with tsc only** | 4.9-5 (4.9 still open) | 4.9-6 |
| 2026-10-28 | 4.9-4: new `pages/IncomeTaxTab.jsx` (wired into `PayrollSettings.jsx` for the Income Tax tab): editable bracket table (add/remove, per-cell inline errors, whole-table problems list shown after the first Save click, Save = PUT whole table, Discard), server 400 `items[i].field` errors mapped back onto cells, banner when the saved table is unusable for payroll, tax-base select saved on its own via PATCH `/calculation` (`taxBase` only), worked-example box on the SAVED table; a background reload after the tax-base save does not unmount the editor (unsaved rows survive); pure `previewFor` added to `bracketView.js` + 1 test (a wrong expected value in my first draft of it was fixed in the test, the helper was right); frontend 108 pass; minimal `.bracket-*`/`.grow` CSS added (final pass 4.9-8); **not built/rendered (no Vite, no node_modules), JSX syntax-checked with tsc only** | 4.9-4 (4.9 still open) | 4.9-5 |
| 2026-10-28 | 4.9-3: `pages/PayrollSettings.jsx` shell at `/hr/settings/payroll` (route in App.jsx, link from Settings; Payroll sidebar item left for 4.16), four ARIA tabs with keyboard support and `?tab=` in the URL, `pages/payrollResource.jsx` (`useResource`, `ResourceState`), temporary bodies loading each tab's GET, `.tabs` CSS, tab helpers in `payrollSettingsView.js`; 2 new tests, **frontend 107 pass; not built or rendered (no Vite)** | 4.9-3 (4.9 still open) | 4.9-4 |
| 2026-10-28 | 4.9-2: new pure `frontend/src/pages/payrollSettingsView.js` for the three remaining tabs: pension/base form (rates 0-100 <= 4 decimals, tax base and pension base validated against their own lists, changed-only PATCH body, `7.0` is not a change), other tax form (base only from the server's `bases` list, a formula is refused, changed-only patch, `otherTaxLine`), deduction item form (four kinds, `absence`/`unpaid_leave` refused, amount >= 0.01, changed-only patch, consumed items detected by `appliedPeriodId`, status text, server `amountMinor` error mapped to the `amount` field); 7 tests in `tests/payrollSettingsView.test.js`, **frontend suite 105 pass** | 4.9-2 (4.9 still open) | 4.9-3 |
| 2026-10-28 | 4.9-1: new `frontend/src/api/money.js` (parseMoney / formatMoney / parseRate, strict, no floats, same rules as backend money.js) and `pages/bracketView.js` (pure: brackets as text rows <-> API minor units, add row starts where the last ends, row + whole-table validation mirroring `validateBrackets` (first starts at 0, gaps, overlaps, open-ended last), `bracketsChanged` compares what would be sent, `serverBracketErrors` maps `items[2].rate` to rows, `previewTax`); 8 tests in `tests/bracketView.test.js` pass, **frontend suite all pass** | 4.9-1 (4.9 still open) | 4.9-2 |
| 2026-10-28 | 4.8b-8: 1 DB test appended to `tests/deductions.test.js`: deleting a draft period sets `applied_period_id` back to null (item loads and PATCHes again), while the approved period cannot be deleted (guard trigger) and its item stays consumed (PATCH/DELETE 409). `node --check` passes. **Written, NOT run. 4.8b complete.** | 4.8b | 4.9 |
| 2026-10-28 | 4.8b-7: 3 HTTP/DB tests appended to `tests/deductions.test.js`: PATCH of a consumed item (amount, rename+pause, make recurring, even a full no-op body) is 409 `conflict` with the row byte-identical and no audit row; DELETE of a consumed item is 409, row stays, no audit row, still listed; unconsumed and recurring items stay editable/deletable next to a consumed one. `node --check` passes. **Written, NOT run: `npm install` is refused by the egress proxy (registry.npmjs.org denied), so express/pg/supertest are missing** | 4.8b-7 (4.8b still open) | 4.8b-8 |
| 2026-10-28 | 4.8b-6: 4 DB tests appended to `tests/deductions.test.js`: load returns enabled items of one employee in engine shape; one-time item applies to one period only while a recurring one applies to all three (recurring never consumed); consume refuses recurring / already consumed / unknown / duplicated ids with 409 and, inside `withTransaction`, leaves even the valid id in a mixed list unconsumed; two connections: the second `FOR UPDATE` load waits for the first, then does not see the consumed item. `beforeEach` now truncates `payroll_periods` + `deduction_items`. **Written, NOT run (no Postgres, no node_modules); file passes `node --check`** | 4.8b-6 (4.8b still open) | 4.8b-7 |
| 2026-10-28 | 4.8b-5: `DELETE /api/deductions/:id` calls `assertNotConsumed` after the locked lookup and before the DELETE: a consumed item gets 409 `conflict`, the row stays and no audit row is written; unconsumed items delete as before; route passes `node --check` (not importable here), HTTP test is 4.8b-7, NOT run | 4.8b-5 (4.8b still open) | 4.8b-6 |
| 2026-10-28 | 4.8b-4: `PATCH /api/deductions/:id` now calls the new pure `assertNotConsumed(item)` (services/deductions.js) right after the locked lookup and before the diff: a consumed item (`appliedPeriodId` set) gets 409 `conflict` even for a no-op PATCH, nothing written, no audit row; 1 pure test (deductionsService 11 pass); route passes `node --check` (not importable here), HTTP test is 4.8b-7, NOT run | 4.8b-4 (4.8b still open) | 4.8b-5 |
| 2026-10-28 | 4.8b-3: `consumeOneTimeDeductions(db, periodId, ids)` in `services/deductions.js` (one UPDATE `WHERE id = ANY($2) AND NOT recurring AND applied_period_id IS NULL`; empty list = no query; ids/period validated first; updated-row count != ids.length throws 409 `conflict` so the generation transaction rolls back; the file now imports only `HttpError`); 4 pure tests added to `tests/deductionsService.test.js` (10 pass there); real-DB test is 4.8b-6, NOT run | 4.8b-3 (4.8b still open) | 4.8b-4 |
| 2026-10-28 | 4.8b-2: `loadDeductions(db, employeeId, {lock})` in `services/deductions.js` (enabled items; recurring always; one-time only while `applied_period_id` is null; ordered by id; `FOR UPDATE` only when `lock`; returns the engine shape via `toEngineDeduction`); 3 pure tests with a fake db client added to `tests/deductionsService.test.js` (6 pass there); real-DB test is 4.8b-6, NOT run | 4.8b-2 (4.8b still open) | 4.8b-3 |
| 2026-10-28 | 4.8b-1: new pure `services/deductions.js` with `toDeduction` (moved out of `routes/deductions.js`, which now imports it; nothing else used the old export) and `toEngineDeduction` (item -> `{kind, label: name, amountMinor, sourceId: id}`); 3 pure tests in new `tests/deductionsService.test.js` pass; route passes `node --check` (not importable here, no express/pg); 4.8b split into 8 subtasks in the phase file | 4.8b-1 (4.8b still open) | 4.8b-2 |
| 2026-10-28 | 4.8a: routes/deductions.js (GET ?employeeId / POST / PATCH /:id / DELETE /:id at /api/deductions, HR only, no-store, audited, no-op PATCH writes nothing), parseDeductionCreate/Update + deductionListQuery in payrollSchemas.js, dbErrors mappings, mounted in server.js, 4 routes added to the employee-403 walk; 9 pure tests pass (payrollSchemas 23; money + engine + schemas + workdays + hrSchemas + attendanceStatus + lockGate 102 pass); 6 DB tests in tests/deductions.test.js written, NOT run | 4.8a | 4.8b |
| 2026-10-28 | 4.7: other taxes API in routes/payrollSettings.js (GET/POST/PATCH/DELETE /api/payroll-settings/other-taxes, base must be one of the engine's four predefined bases, unique name 409, audited, no-op writes nothing), parseOtherTaxCreate/Update, `loadOtherTaxes` for the engine, dbErrors mapping, employee-403 walk extended; 6 pure tests pass (payrollSchemas 14; money + engine + schemas + workdays + hrSchemas + attendanceStatus + lockGate 93 pass); 6 DB tests written, NOT run | 4.7 | 4.8 |
| 2026-10-28 | 4.6: GET/PATCH /api/payroll-settings/calculation (employee + company pension rate, tax base, pension base; partial, audited, no-op writes nothing), parseCalculationSettings, loadSettings for the engine; 4 pure tests pass (payrollSchemas 8, with money + engine 29 pass); 5 DB tests written, NOT run | 4.6 | 4.7 |
| 2026-10-28 | 4.2: services/money.js (percentOf, divRound, sumMinor, parseMoney, formatMoney, 4 rounding modes, BigInt products); 7 pure tests pass | 4.2 | 4.3 |
| 2026-10-28 | 4.3 + 4.4: services/payrollEngine.js (computeEntry, validateBrackets, findBracket, PayrollError codes invalid_input / invalid_brackets / no_bracket); 14 pure tests (spec #12-15 plus bases, rounding, 500 generated cases checking the identities); money + engine 21 pass | 4.3, 4.4 | 4.5 |
| 2026-10-28 | 4.5: routes/payrollSettings.js (GET/PUT /api/payroll-settings/brackets, whole-table replace in one transaction, validated, audited), services/payrollSchemas.js (parseBracketTable), PUT added to tests/hrClient.js; 4 pure schema tests pass; 3 DB tests written, NOT run | 4.5 | 4.6 |
| 2026-10-28 | 4.1: 004_payroll.sql (8 tables, spec 17 CHECKs, immutability triggers), TRUNCATE_ALL updated, 7 DB tests appended to schema.test.js; **never applied, no Postgres** | 4.1 | 4.2 |
| 2026-10-28 | 3.9: 2 end-to-end tests appended to tests/leave.test.js (approve via API -> on_leave rows in the HR list, holiday skipped, pending/rejected write nothing; scan refused on leave with no row). Balances/overlap/race tests already existed from 3.3/3.4. **DB tests written, not run** | 3.9 | 4.1 |
| 2026-10-28 | 3.8: attendanceStatus.js (`fillAttendanceGaps`, `applyApprovedLeaveToAttendance`, `fillWindow`, `missingDayStatus`; holiday + approved-leave rules in `classifyForEmployee`/`classifyCheckIn`), wired into leave approval and the HR attendance list; 9 new pure tests pass, 8 DB tests written not run; **SQL never run (no Postgres)** | 3.8 | 3.9 |
| 2026-10-28 | 3.7: routes/settings.js (holidays CRUD, audited, 409 on duplicate date), schemas, dbErrors mapping, mounted at /api/settings; pages/Settings.jsx + SettingsDialogs.jsx + settingsView.js (holidays and working schedules/shifts with weekday checkboxes); 6 DB tests written not run, 1 pure schema test + 7 frontend tests pass (frontend 90); **not built/rendered, DB tests not run** | 3.7 | 3.8 |
| 2026-10-28 | 3.6: HR leave page (pages/Leave.jsx queue + entitlements, LeaveDialogs.jsx approve/reject/change-balance, leaveAdminView.js), route, `.toolbar-4`; 9 new tests, frontend 83 pass; **not built/rendered (no Vite)** | 3.6 | 3.7 |
| 2026-10-28 | 3.2: services/workdays.js (workingDaysBetween, isWorkingDay, workingDaysForEmployee); 11 pure tests pass, mutation-checked | 3.2 | 3.3 |
| 2026-10-28 | 3.1: migration 003_leave.sql (leave_types seeded, leave_balances, leave_requests with exclusion constraint against overlapping approved leave, holidays), 6 schema tests, TRUNCATE_ALL updated; **not applied/run (no Postgres)** | 3.1 | 3.2 |
| 2026-10-28 | 2.20: tests/attendance.test.js (spec 26 #7-11, 12 DB tests, not run) | 2.20 | 3.1 |
| 2026-10-28 | 2.19: `GET /api/attendance/mine`, HH:MM times on the scan confirmation, Scan.jsx submit + confirmation card + failure handling, pages/portal/History.jsx, attendanceView.js; **fixed companyDate/companyTime default timezone bug** (`config.timezone` -> `config.company.timezone`); frontend 66 pass, backend pure 21 pass, DB tests written not run (no Postgres/network this session) | 2.19 | 2.20 |
| 2026-10-28 | 2.18: PATCH /api/attendance-records/:id (required reason, company-timezone times, locked row, audit with from/to), local `HH:MM` + `today` in the list, pages/Attendance.jsx + CorrectionDialog.jsx + attendanceForm.js, route + CSS; backend 268 pass / 0 fail, frontend 58 pass, build OK; not rendered in a browser | 2.18 | 2.19 |
| 2026-10-28 | 2.17: routes/attendanceRecords.js (HR list with date/employee/department/status filters + pagination; signed 5-minute selfie links, audited), schemas in hrSchemas.js, mounted at /api/attendance-records; 9 DB tests; full suite 257 pass / 0 fail | 2.17 | 2.18 |
| 2026-10-28 | 2.16: services/attendanceStatus.js (classifyCheckIn, classifyForEmployee), `classify` callback in applyScan/submitScan, route wired; 22 pure + 4 DB tests; **first real run of the whole backend suite on Postgres 16: 248 pass / 0 fail**, fixed 3 test-isolation bugs; frontend 48 pass + vite build OK | 2.16 | 2.17 |
| 2026-10-19 | 2.15: submitScan (refusal check, upload, transaction, photo cleanup with original error preserved), companyDate, route wired to 201 confirmation payload, swappable photo store; reconciled a duplicate 2.13 draft; 20 pure tests pass, DB tests written not run | 2.15 | 2.16 |
| 2026-10-19 | 2.14: applyScan transaction (token FOR UPDATE, record FOR UPDATE, consume token, write with DB clock, audit; ON CONFLICT duplicate guard), checkQrToken {lock}; 6 pure tests pass (13 in file), 9 DB tests written not run | 2.14 | 2.15 |
| 2026-10-19 | 2.13: services/attendance.js (nextAction, decideAction with optional FOR UPDATE); 7 pure tests pass, 4 DB tests (decision, row lock) written not run | 2.13 | 2.14 |
| 2026-10-19 | 2.12: routes/attendance.js (POST /scan: employee guard, body validation, active-employee check, token validation, per-user throttle, 501 skeleton), services/scanRequest.js, checkQrToken/tokenProblem in qrToken.js, per-route body limit in server.js; 8 pure tests pass, 12 DB tests written not run | 2.12 | 2.13 |
| 2026-10-19 | 2.11: api/image.js (bisection JPEG compression to <=160 KB, camera error text), Scan.jsx camera flow (open, live preview, capture, retake; no file input), selfie CSS; 6 new tests (frontend 48 pass); not rendered (no vite) | 2.11 | 2.12 |
| 2026-10-19 | 2.10: pages/portal/scanToken.js, Scan.jsx stub + /portal/scan route, RequireRole/LoginRoute carry the token in router state, referrer meta; 4 new tests (frontend 42 pass); not rendered | 2.10 | 2.11 |
| 2026-10-19 | 2.9: services/cloudinary.js (private upload, signed expiring URL, idempotent delete, id validation), scripts/cloudinary-smoke.js; 8 unit tests pass (fake SDK). Real Cloudinary not exercised | 2.9 | 2.10 |
| 2026-10-19 | 2.8: tests/lock.test.js (11 tests, spec 26 #2-6); syntax-checked only, not run (no node_modules). Phase 2 Day 5-6 items done | 2.8 | 2.9 |
| 2026-10-19 | 2.7: UnlockDialog.jsx, Unlock button on QR page, `describeUnlockError`; 1 new test (frontend 38 pass); not rendered | 2.7 | 2.8 |
| 2026-10-19 | 2.6: `layoutMode` helper + HrLayout refactor, focus/visibility lock sync in auth.jsx; 1 new test (frontend 37 pass); not rendered | 2.6 | 2.7 |
| 2026-10-19 | 2.5: pages/QrAttendance.jsx, pages/qrState.js, /hr/qr route, QR CSS, `setLocked` in auth context; 3 new tests (frontend 36 pass); JSX not compiled/rendered (no vite in sandbox) | 2.5 | 2.6 |
| 2026-10-19 | 2.4: services/qrToken.js, POST /api/qr/tokens (+30/min cap); tests/qrToken.test.js, 3 pure tests pass (7 total with lockGate); issuing SQL verified in Postgres via psql (old token expired, new one 45 s). Route not HTTP-tested (no node_modules) | 2.4 | 2.5 |
| 2026-10-19 | 2.3: routes/qr.js (POST /lock, POST /unlock with password re-check, own limiter, audit rows), mounted in server.js; syntax-checked only, HTTP tests are 2.8 (npm registry still blocked, no node_modules) | 2.3 | 2.4 |
| 2026-10-19 | 2.2: middleware/lock.js (global allowlist gate, 423 elsewhere) wired into server.js; tests/lockGate.test.js, 4 pure tests pass (run with node --test). Full-app HTTP tests still blocked: npm registry unreachable in sandbox | 2.2 | 2.3 |
| 2026-10-19 | 2.1: `002_attendance.sql` (attendance_tokens, attendance_records); 5 new tests in schema.test.js + helpers truncate list. **Verified by applying 001+002 to a real Postgres 16 with psql and exercising every constraint** (duplicate employee+date rejected, etc.). The Node tests were syntax-checked but NOT run: npm registry is blocked by the sandbox egress policy this session, so no node_modules | 2.1 | 2.2 |
| 2026-10-19 | 1.17: `GUARD` marker in auth.js; 5 new tests in auth.test.js (router-guard walk, employee 403 on all HR routes, no role escalation, forged/ended session, HR control) + 1 todo for salary; not run (no Postgres) | 1.17 | 2.1 |
| 2026-10-19 | 1.16: pages/Employees.jsx, EmployeeDialog.jsx, employeeForm.js; portal shell (PortalLayout, portalNav, bottom tabs) and nested /portal routes; page CSS; 6 new tests (frontend 33 pass); components syntax-checked only, not rendered | 1.16 | 1.17 |
| 2026-10-19 | 1.15: routes/employees.js (list/get/create/patch/activate/deactivate, no DELETE), departments.js, shifts.js; services/sql.js, dbErrors.js, hrSchemas.js; `intList` validator rule, `diffFields` audit helper; 14 pure tests pass; 33 HTTP/DB tests written, NOT run (no node_modules, no Postgres in sandbox) | 1.15 | 1.16 |
| 2026-10-19 | 1.14: HrLayout (top bar, 7-item sidebar, mobile drawer, locked-tablet shell), hrNav helpers, nested /hr routes in App.jsx; 6 new tests (frontend 27 pass); browser-tested with router/auth stand-ins | 1.14 | 1.15 |
| 2026-10-19 | 1.13: styles.css (dark/light tokens), Button/Field/Modal/Table(+Badge,Pager)/Toast/ThemeToggle, pagination + toast + theme helpers; 7 new tests (frontend 21 pass); rendered and interaction-tested in Chromium in both themes and at 375 px | 1.13 | 1.14 |
| 2026-10-19 | 1.12: pages/Login.jsx, api/paths.js (homePath + safe redirectTarget), LoginRoute honours saved `from`; 6 new tests (frontend 14 pass); components not rendered (no network) | 1.12 | 1.13 |
| 2026-10-19 | 1.11: Vite shell, api/client.js (CSRF header, ApiError, session events), api/auth.jsx (AuthProvider, /me restore), App.jsx routes + RequireRole; 8 client tests pass; build/dev server not run (no network) | 1.11 | 1.12 |
| 2026-10-19 | 1.10: middleware/validate.js (schema validator + middleware, field-level 400s, unknown keys stripped, query coercion); 14 new tests (10 pure pass, 4 HTTP not run: no node_modules in sandbox) | 1.10 | 1.11 |
| 2026-10-19 | Planned 77 tasks over 21 days, LOC budget, UI reference notes, packaged plan folder | — | 1.1–1.4 (Day 1) |
| 2026-10-19 | Merged plan folder into the project as `plan/`; single `natra-erp.zip` | — | 1.2 |
| 2026-10-19 | 1.9: middleware/auth.js (role guards with default-deny lock), services/audit.js (redacting, transaction-aware); login/logout/seed now audited; 13 new tests (75 total, all pass; 56 skip without a DB) | 1.9 | 1.10 |
| 2026-10-19 | 1.8: rateLimit.js, routes/auth.js (login/logout/me), wired at /api/auth; 15 new tests (62 total, all pass; 44 skip without a DB) | 1.8 | 1.9 |
| 2026-10-19 | 1.7: csrf.js (Origin check + session-bound token), wired into server.js; 9 new tests (47 total, all pass; 33 skip without a DB) | 1.7 | 1.8 |
| 2026-10-19 | 1.6: session.js (load/create/destroy), config.cookie, wired into server.js; 11 new tests (38 total, all pass; 27 skip without a DB) | 1.6 | 1.7 |
| 2026-10-19 | 1.5: password.js, seed.js (+ --reset-password), tests/helpers.js; 9 new tests (27 total, all pass; 17 skip without a DB); seed CLI exercised on a fresh DB | 1.5 | 1.6 |
| 2026-10-19 | 1.4: migration 001_core.sql (6 tables, constraints, triggers, seeded shift), 8 schema tests (18 total, all pass); verified on a fresh DB and idempotent re-run | 1.4 | 1.5 |
| 2026-10-19 | 1.3: pool.js, migrate.js, 6 new tests (10 total; 4 skip without a DB); verified against local Postgres 16 | 1.3 | 1.4 |
| 2026-10-19 | 1.2: config.js, server.js with /health, error + CORS middleware, 4 passing tests; smoke-tested live server | 1.2 | 1.3 |
| 2026-10-19 | 1.1: monorepo folders, root/backend/frontend package.json, .env.example, .gitignore; `npm install` succeeds in backend and frontend | 1.1 | 1.2 |


## Engine notes (tasks 4.3, 4.4)
- `services/payrollEngine.js`, pure. `computeEntry({settings, brackets, otherTaxes, profile, deductions})` returns camelCase amounts matching `payroll_entries` plus `items` matching `payroll_entry_items`. The caller converts pg bigint/numeric strings to Numbers and maps names; the route (4.11/4.12) never trusts client-sent amounts.
- Rules chosen: tax base and pension base per settings (allowance flags only matter when the base includes allowances); **an employee with `pension_applies = false` has pensionable 0, both pension shares 0, and 0 for any other tax based on `pensionable`**; bracket = from <= income < to; invalid or non-matching brackets throw (no silent zero tax); each percentage is rounded once; **net may be negative** (the DB allows it; HR sees it).
- Attendance deductions (absence, unpaid leave) are passed in as ordinary `deductions` with kind `absence` / `unpaid_leave`; 4.15 decides the amounts and applies them once. The engine does not know about attendance.
- `validateBrackets` (empty list, not starting at 0, gap, overlap, no open-ended last bracket, bad rate/negatives) is exported for the API (4.5) and the UI.
- Test environment this session: Postgres 16 was available and started, but the npm registry was blocked, so `npm ci` failed and **DB tests, frontend tests and the Vite build could not run**. Pure tests ran with plain `node --test`.

## Bracket API notes (task 4.5)
- `GET /api/payroll-settings/brackets` -> `{items, problems}`; `PUT` with `{items:[{fromMinor, toMinor|null, rate, fixedDeductionMinor}]}` replaces the WHOLE table (a gap/overlap belongs to the table, not a row), so the UI edits a local list and saves once. Money is whole minor units, rate <= 4 decimals; an invalid table is 400 `validation` (`fields.items` lists the problems) and the saved table is untouched. Audit action `payroll.brackets.replace` (before/after).
- Mounted at `/api/payroll-settings` (HR only); 4.6 and 4.7 add pension/base settings and other taxes to the same router. Payroll generation (4.11) must call `validateBrackets(loadBrackets())` and refuse when it returns problems (the engine also throws `invalid_brackets`).
## Pension and bases API notes (task 4.6)
- Mounted in the same router as the brackets (`routes/payrollSettings.js`, `/api/payroll-settings`, HR only, locked tablet 423). **`GET /calculation`** -> `{taxBase, pensionBase, employeePensionRate, companyPensionRate}`; **`PATCH /calculation`** with any of those keys (partial: omitted = unchanged, unknown keys dropped, so `roundingMode` and the absence/unpaid-leave switches cannot be set here) -> the saved values. It is PATCH, not PUT, because it edits one row of settings, unlike the brackets table which is replaced whole.
- Validation (`parseCalculationSettings` in `services/payrollSchemas.js`, pure): rates are numbers 0-100 with at most 4 decimals (0 is allowed, a string is refused); `taxBase` in `basic | basic_plus_taxable_allowance`, `pensionBase` in `basic | basic_plus_pensionable_allowance` (the lists are the engine's `TAX_BASES` / `PENSION_BASES`, so a tax base value is refused as a pension base); an empty body is 400 on `_`. One bad key saves nothing.
- Writes lock the single settings row (`FOR UPDATE`), save only the keys that differ, and audit `payroll.settings.update` with `details.changes = {field: {from, to}}`. A request that changes nothing returns 200 and writes no audit row.
- `loadSettings(db, {lock})` and `toSettings(row)` are exported and return the exact `settings` shape `payrollEngine.computeEntry` reads (including `roundingMode`, read-only here): **4.11/4.12 should call `loadSettings` inside the generation transaction** rather than re-querying. Changing settings only affects drafts; approval snapshots them (4.13).
- Not here: editing the rounding mode and the absence/unpaid-leave switches (4.15 decides how those are exposed), the settings page (4.9).
- Tests: `tests/payrollSchemas.test.js` +4 pure (pass); `tests/payrollSettings.test.js` +5 DB tests (guards, defaults + persistence across sessions, engine reads what was saved, bad input per field, audit/no-op/mass-assignment). **DB tests NOT run: no Postgres, and this sandbox's `node_modules` is broken (a failed `npm ci`, `pg` unresolvable), so 24 DB-backed test files fail to even load; the same files load fine on a working install. Pure suites run with plain `node --test <file>`.**

## Deduction items API notes (task 4.8a)
- `routes/deductions.js`, mounted at **`/api/deductions`** (own router, `noStore, requireHr` at router level, so the guard-walk test passes; locked tablet 423). Not under `/api/payroll-settings`: items belong to an employee, not to the company settings.
- **`GET /?employeeId=`** (required) -> `{items}` oldest first, no paging; unknown employee 404. **`POST /`** `{employeeId, kind, name, amountMinor, recurring?, enabled?}` -> 201 (defaults: one-time, enabled). **`PATCH /:id`** partial (`kind, name, amountMinor, recurring, enabled`); omitted = unchanged, unknown keys dropped (`employeeId`, `appliedPeriodId` cannot be set), empty body 400 on `_`, a no-change request returns 200 and writes no audit row (no UPDATE either, so `updatedAt` does not move). **`DELETE /:id`** -> 204 (real delete, audited with the old values).
- Item shape (what `loadDeductions` in 4.8b will map from): `{id, employeeId, kind, name, amountMinor, recurring, enabled, appliedPeriodId|null, createdAt, updatedAt}`. Engine wants `{kind, label: name, amountMinor, sourceId: id}`.
- `kind` is `advance | loan | penalty | other` only (`DEDUCTION_ITEM_KINDS`; a pure test pins it to the SQL CHECK and to the first four engine kinds). `absence` / `unpaid_leave` cannot be entered here, they come from 4.15. Amount: whole minor units, 1 to 9,999,999,999,999 (same ceiling as the DB).
- Audit: `payroll.deduction.create|update|delete`, entity `deduction_item` (update stores `employeeId, name, changes {field:{from,to}}`).
- `dbErrors.js`: FK `deduction_items_employee_id_fkey` -> 400 on `employeeId` ("Employee not found"); CHECK `deduction_items_recurring_never_consumed` -> 400 on `recurring`; amount CHECK -> 400 on `amountMinor` (backstops only, the parser/route catch these first).
- **Deliberately NOT here (4.8b):** refusing PATCH/DELETE of an already-consumed one-time item with 409. Today the only guard is the DB CHECK, which stops a consumed item being made recurring (400). **4.8b must add the 409 check inside the `FOR UPDATE` section of PATCH and DELETE** (`findItem(..., {lock: true})` already returns `appliedPeriodId`). Also 4.8b: `loadDeductions`, `consumeOneTimeDeductions`, and the "deleting a draft period frees its items" behaviour (already provided by `ON DELETE SET NULL` on `applied_period_id`).
- Inactive employees may still have items (nothing in spec says otherwise); 4.11 only generates for active employees.
- Tests: `tests/payrollSchemas.test.js` +9 pure (pass); `tests/deductions.test.js` 6 DB tests (guards, CRUD round trip + audit, bad input per field saves nothing, 404/400 ids, no-op + mass assignment, one-time/recurring toggle and pause) and the four routes in `auth.test.js`'s employee-403 walk: **NOT RUN (no Postgres, no node_modules in this sandbox)**; all files pass `node --check`, but the route could not be imported (express/pg not installed).
- **First thing with Postgres:** `npm test` in backend (deductions, payrollSettings, auth, schema suites). Two things to watch: the FK constraint name `deduction_items_employee_id_fkey` and the amount CHECK name `deduction_items_amount_minor_check` are Postgres's auto-names, assumed not verified.

