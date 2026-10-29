# Phase 5: Testing and Deployment  (est. ~210 LOC)

Format: **Read** = reference to open first · **Open** = files to create/edit · **Done when** = acceptance check.


## Day 19: Test sweep

### 5.1 Map all 17 required tests to files, fill gaps
- [x] Status — all 17 requirements mapped to exact case names in references/required-tests.md; five embedded SQL/HTTP coverage gaps filled. test:required-local 74/74; full backend 236 pass, 277 external-DB skips; frontend 121/121. Native #9 concurrency and live Cloudinary/device verification remain pending.
- **Read:** references/spec-digest.md §26
- **Open:** `backend/tests/`
- **Done when:** Every test has a named case

### 5.2 Run all tests, fix failures, check logs for secrets
- [x] Status — CLOSED 2026-10-28. Native PostgreSQL 16 sweep: backend 517 pass / 0 fail / 0 skipped (includes the 12 multi-connection cases); frontend 121 pass. The first native run found 2 test-only failures (fixed, no product code changed): a late-minutes assertion that compared at sub-second precision while the classifier works in whole seconds, and payrollSettings.test.js leaving the seeded settings row modified for schema.test.js. Native-run output and API log contain none of the credential values used. Earlier embedded-engine sweep, delete-conflict and secret-safe logging fixes stand. Live Cloudinary and tablet/phone flows are NOT covered here (5.9). See references/test-sweep.md.
- **Read:** references/spec-digest.md §22
- **Open:** `backend/tests/`
- **Done when:** All green; no tokens/passwords in logs


## Day 20: Deployment

### 5.3 Production builds (frontend + backend)
- [x] Status — root build checks 57 backend native ES modules and builds Vite frontend; production API boot/health/CORS/anonymous guard/config checks pass; built-frontend mocked browser checks pass. See references/production-builds.md.
- **Read:** references/spec-digest.md §23
- **Open:** `frontend/package.json, backend/package.json`
- **Done when:** Builds succeed

### 5.4 render.yaml and final .env.example
- [x] Status — two-service Blueprint passed official Render JSON Schema; final env template, root Vite env loading, direct migration URL and public API wiring verified. Clean production-only backend install/boot and bundle privacy checks pass. See references/render-configuration.md.
- **Read:** references/spec-digest.md §2, §23
- **Open:** `render.yaml, .env.example`
- **Done when:** Both services defined; all env vars listed

### 5.5 Startup migration and memory check (<512 MB)
- [x] Status
- **Read:** references/spec-digest.md §23
- **Open:** `backend/src/server.js`
- **Done when:** Idle/load memory recorded — see `references/startup-memory.md` (idle ~70 MB, peak 112 MB)


## Day 21: Docs and wrap-up

### 5.6 README: setup, env vars, deploy, UptimeRobot
- [x] Status — root README.md written: local setup, tests, env-var table, Render+Neon+Cloudinary deploy, one-off HR seed, cookie caveat, UptimeRobot, layout, honest status/gaps. Steps verified 2026-10-28 on a clean extract: npm ci, migrate (4 applied), seed, API boot + /health + HR login, Vite dev server on 5173, root build, seeding a second database via shell override. Not verified: a real Render/Neon deploy, UptimeRobot setup (written from documented behaviour).
- **Read:** references/spec-digest.md §23, §28
- **Open:** `README.md`
- **Done when:** New developer can run it from README

### 5.7 Backup guide, photo retention/deletion, manual attendance fallback, same-day-shift note
- [x] Status — DONE 2026-10-28. README section 7 (Operations guide): 7.1 backups (Neon history + own pg_dump/pg_restore, restore into a new database, drill, sensitivity), 7.2 selfie retention/deletion (date cutoff and per-employee procedure using the app's own idempotent delete, delete-before-clear order, audit row, orphan reconciliation via the 16-hex SHA-256 log reference), 7.3 manual attendance fallback (paper sheet, HR Correct with required reason, limits), 7.4 same-day-shift limit. Checked against the code: reference hash recipe matches services/attendance.js, migration table is schema_migrations(filename), 62-day gap-fill window, purge snippet imports/paths run and fail safe unconfigured. NOT run: pg_dump/pg_restore against Neon, the purge against real Cloudinary. No application code changed.
- **Read:** references/spec-digest.md §8, §22, §23
- **Open:** `README.md (docs section)`
- **Done when:** All four documented

### 5.8 Real LOC report with cloc and tradeoffs
- [x] Status — Report written 2026-10-28 (`loc-report.md`), but the done-when is NOT met: counted by the budget's own definition (tests included) the project is 14,343 code lines, 59% over the 9,000 ceiling; production code alone is 7,196 (within). cloc could not be installed (no network), so figures come from `plan/references/count-loc.py`, which applies cloc's definitions; run real cloc to confirm. Owner decision on how to treat the overrun is open (three options in the report).
- **Read:** references/spec-digest.md §28, loc-budget.md
- **Open:** `loc-report.md`
- **Done when:** Report within 9,000 ceiling

### 5.9 End-to-end check: lock, scan, selfie, attendance, leave, payroll, payslip
- [ ] Status
- **Read:** references/spec-digest.md §28
- **Open:** `—`
- **Done when:** Full flow works on tablet + phone
