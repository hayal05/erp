# Required-test coverage — task 5.1

All 17 spec §26 requirements have a named test case. **This is coverage, not a claim that every environment-dependent check passed.** The table separates locally executed evidence from remaining infrastructure/device checks.

Paths are relative to the project root. Case names below match the source declarations exactly.

| # | Requirement | File and named case | Verification |
|---|---|---|---|
| 1 | Employee cannot reach HR pages or others’ salary | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #1: ownership, draft hiding, guessed IDs, HR endpoints and tablet lock**; `frontend/tests/paths.test.js` — **a saved page in the other role's area falls back to home** | Local API/ownership and redirect-helper checks pass; real-device UI checkpoint pending. |
| 2 | Locked session blocked from admin endpoints | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #2/#3: locked HR cannot bypass admin guards with methods or URL changes** | Local SQL/HTTP pass, including all newer payroll/dashboard/settings routes. |
| 3 | URL changes cannot bypass lock | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #2/#3: locked HR cannot bypass admin guards with methods or URL changes**; `backend/tests/lockGate.test.js` — **isAllowedWhileLocked is exact-match only** | Local SQL/HTTP and gate-unit pass. |
| 4 | Refresh preserves server lock | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #4/#5: refresh retains lock; only valid password reauthentication unlocks** | Local HTTP state restoration pass; device refresh checkpoint still required. |
| 5 | Unlock requires valid password reauthentication | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #4/#5: refresh retains lock; only valid password reauthentication unlocks** | Local SQL/HTTP pass; native lock.test.js also has wrong-password throttling cases. |
| 6 | Unlocking one device does not unlock another | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #6: locking and unlocking one HR device never changes another session** | Local SQL/HTTP pass with two independent cookie sessions. |
| 7 | Tokens expire | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #7/#8/#10: expired/replayed tokens rejected and first valid scan checks in** | Local SQL/HTTP pass with forced past expiry and no photo upload. |
| 8 | Consumed tokens cannot be replayed | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #7/#8/#10: expired/replayed tokens rejected and first valid scan checks in** | Local SQL/HTTP pass; replay rejected without a second upload/attendance row. |
| 9 | Concurrent requests do not duplicate attendance | `backend/tests/attendanceScan.test.js` — **concurrency: two simultaneous scans with the SAME token (two people) -> exactly one succeeds**; `backend/tests/attendanceScan.test.js` — **concurrency: two simultaneous check-ins by ONE person (different tokens) -> one record, the loser keeps its token** | PENDING native PostgreSQL: named multi-connection cases exist but are skipped here. PGlite does not prove concurrency. |
| 10 | No check-out before check-in | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #7/#8/#10: expired/replayed tokens rejected and first valid scan checks in**; `backend/tests/attendanceAction.test.js` — **check-out is never returned without a check-in** | Local SQL/HTTP, database constraint and action-unit pass. |
| 11 | Selfies are not public | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #11: photo links are HR-only, no-store and audited; employee history hides photo IDs**; `backend/tests/cloudinary.test.js` — **upload is private ("authenticated"), random-named, and returns only the public id**; `backend/tests/cloudinary.test.js` — **signed URLs are authenticated, expire, and the lifetime is capped** | Local access-control/Cloudinary-contract checks pass with storage stubbed; live Cloudinary privacy verification remains pending. |
| 12 | Correct bracket rate and fixed deduction | `backend/tests/payrollEngine.test.js` — **#12 the bracket picks the right rate and fixed deduction (2,500 at 15% minus 150 = 225), edges are from <= income < to** | Engine-unit pass, including bracket boundaries. |
| 13 | Employee and employer pension are distinct | `backend/tests/payrollEngine.test.js` — **#13 employee and company pension are distinct; only the employee share reduces net, only the company share adds to cost** | Engine-unit pass; employer share does not reduce employee net. |
| 14 | Flat deductions are summed | `backend/tests/payrollEngine.test.js` — **#14 flat deductions are summed into Other Deductions, with the breakdown kept** | Engine-unit pass; embedded suite also verifies one-time allocation. |
| 15 | Net salary formula is correct | `backend/tests/payrollEngine.test.js` — **#15 net salary = gross - income tax - other taxes - employee pension - other deductions (worked example)** | Engine-unit pass, with exact minor-unit arithmetic. |
| 16 | Approved payroll cannot be recalculated | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #16: approved/paid HTTP recalculation and direct SQL writes are blocked** | Local SQL/HTTP pass, including direct SQL guards and paid-period lock. |
| 17 | History survives later configuration changes | `backend/tests/payrollEmbedded.test.js` — **embedded PostgreSQL #17: snapshot, entries, payslip and CSV history survive configuration/source edits** | Local SQL/HTTP pass across snapshot/entries/detail/payslip/CSV and next-draft inputs. |

## Commands

From `backend/` after `npm ci`:

```sh
npm run test:required-local
npm run test:payroll
npm test
```

`test:required-local` runs the embedded SQL/HTTP checks plus lock-gate, QR, attendance action, Cloudinary-contract, payroll-engine and frontend redirect/navigation helpers. It deliberately excludes multi-connection test #9; a passing local command must not be described as all 17 requirements verified.

For the external PostgreSQL suites, set `TEST_DATABASE_URL` to a dedicated database with `test` in its name, then run `npm test`. Those suites truncate test data. Without that variable they are skipped, while embedded checks still run.

## Gaps addressed in this task

Five new embedded test cases make requirements #2–8, #10 and the API portion of #11 executable without a native server. They extend lock checks to the new payroll/settings/dashboard endpoints and adversarial paths, verify session restoration and per-device isolation, execute real token expiry/replay and check-in SQL, and confirm photo-link authorization/audit/redaction. All four original migrations run unchanged. Photo storage/signing is stubbed; no real selfies or credentials are required.

The original native cases remain intact. Multi-connection attendance (#9), other serialization/race tests, production Cloudinary privacy, and tablet/phone camera/refresh flows remain pending. PGlite is single-session; no Promise-based mock race is used as a substitute.

Phase 5.2 owns the full test sweep, failure fixes and log-secret review. Phase 5.9 owns the real-device end-to-end checkpoint.


## Recorded verification (2026-10-28)

- `npm run test:required-local`: 74 passed, zero skipped/failures/todos.
- Backend `npm test`: 236 passed, 277 external-server tests skipped, zero failures/todos.
- Frontend `npm test`: 121 passed, zero skipped/failures/todos.
- Embedded suite: 11 SQL/HTTP cases passed against the unmodified schema.

These results do not convert the pending native #9 race tests or live provider/device checks into passes.


## Phase 6 test map (Departments, Positions, default salary)

These are new tests for the owner-requested Phase 6; they are not among the 17 original requirements. All database files skip without `TEST_DATABASE_URL` and are picked up automatically by `test:db-embedded`; none of them is in the 12 excluded multi-connection cases.

| Rule | Where |
|---|---|
| Positions table: defaults, unique name per department (any case), money limits, department/position consistency (composite key + CHECK) | `schema.test.js` (migration 005 block, 7 cases) |
| Position validation shares the salary-profile rules; one function writes salary profiles | `positionSchema.test.js`, `salaryProfileService.test.js` |
| Positions API: HR only, CRUD, duplicates, full-body edit, audit, delete guard | `positionsApi.test.js` |
| Department `positionCount`, detail route, delete blocked by positions (message order) | `orgstructure.test.js` |
| Employee schema/422/400 mapping and `loadAssignablePosition` (pure) | `positionAssign.test.js` |
| Package copied on create; apply / decline on position change; manual edit stays personal; later position edit leaves people alone; department-change rules; mismatch 422; job title owned by the position; clearing keeps salary; employee role denied; rollback leaves no half-created employee; approved payroll unchanged and next draft uses the new salary | `positions.test.js` (15 cases) |
| Frontend: department name rules, delete explanation (positions before employees), error mapping, address id check | `frontend/tests/departmentView.test.js` (8) |
| Frontend: position form validation, exact money (type, store, show, type again), full-body payload, change detection, server-field mapping, rows, totals, delete and edit notices | `frontend/tests/positionForm.test.js` (12) |
| Frontend: employee create/patch payloads with `positionId` and `applyPositionSalary`, department change drops or restores the position, salary plan (preview, change, same, cleared), save-error mapping, and a drift guard that every key the browser sends appears in the server schemas | `frontend/tests/employeeForm.test.js` |
| Frontend: sidebar is the 8 items in order, Departments active on the detail route, locked tablet reaches only `/hr/qr` | `frontend/tests/hrNav.test.js` |
| Still manual: whole flow on a fresh database and on the deployed Render URL from a phone | task 6.12 |
