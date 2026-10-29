# Test sweep and logging review — task 5.2

## Scope

The local/backend, frontend and single-session PostgreSQL-engine runs are verified below. **Task 5.2 remains open for 12 native PostgreSQL multi-connection cases.** This environment cannot switch from root to an unprivileged user to start a native server. PGlite is not used as a substitute for race/row-lock/serialization verification.

From the project root:

```sh
npm --prefix backend test
npm --prefix backend run test:db-embedded
npm --prefix frontend test
npm --prefix frontend run build
```

`test:db-embedded` runs the existing database suites in isolated in-memory PostgreSQL engines, one per Node worker. It uses the original migration runner and unchanged migrations. Its test-only adapter preserves pg's bigint-as-text behavior and supports multi-statement migration SQL. The runner prints the number of excluded cases. It does not connect to a server, and its row-lock behavior must not be cited as evidence for concurrency. The ordinary native suites still run when `TEST_DATABASE_URL` points to a dedicated test database.

## Failures fixed

1. Deleting an assigned department or shift could return 500 for PostgreSQL `restrict_violation` SQLSTATE `23001`. The existing foreign-key helper recognized only `23503`; it now recognizes both and preserves the intended 409 `in_use` response. Database constraints remain unchanged.
2. A payroll schema test changed gross while leaving default net/employer-cost based on the original gross. It could violate multiple constraints and fail on an unintended constraint first. Its fixture now derives dependent values from the effective gross so the test isolates the intended constraint.
3. The period-deletion immutability assertion expected the word “locked” although the trigger correctly says the approved period “cannot be deleted.” It now checks the deletion-specific refusal.

All 33 targeted organization/schema cases passed after these fixes.

## Logging changes and checks

- Request, idle-database, migration CLI and seed CLI failures use an allowlisted event and allowlisted error code. No raw exception text/stack, request body/path/query, database URI or SQL parameters are logged.
- Production 500 responses discard exception details as well as masking the message.
- Failed orphan-photo cleanup logs a 16-hex SHA-256 reference instead of the private storage identifier. Retention/orphan reconciliation can hash candidate provider IDs and compare references; it must not restore raw IDs to application logs.
- Audit redaction now also covers nested API keys, credential objects, database/connection URLs and photo/selfie identifiers.
- Regression tests inject synthetic secret canaries into errors, request data and audit fields, capture console output and assert absence of those values. Orphan cleanup asserts that only the hashed reference appears and the original error is preserved.
- Remaining direct output sites were inspected: startup prints only the port; seed success messages are fixed text; migration progress uses source-controlled filenames. These do not log request credentials or database values.

The log review covers application-controlled output and the tested console/audit paths, not hypothetical behavior of every external service. Test/provider fixtures contain synthetic values only.

## Native cases still pending

The exact excluded names are maintained in `backend/test-support/run-embedded-sweep.mjs`: four simultaneous attendance scans, one attendance row-lock wait, two concurrent corrections, one-time deduction contention, simultaneous leave requests/approvals, and concurrent payroll creation/approval/payment (12 cases total; the corrections group is one named case). Run these against a native PostgreSQL test server before signing off task 5.2 or deployment readiness. Cloudinary live privacy and real tablet/phone flows also remain separate checkpoints.

The next independent implementation task is 5.3 (production builds).


## Recorded results (2026-10-28)

| Run | Result | Limitation |
|---|---|---|
| Standard backend | 240 passed, 277 skipped, zero failures/todos | Native-server suites skipped without TEST_DATABASE_URL |
| Embedded serial DB sweep | 275 passed, zero failures | 12 exact named native multi-connection cases excluded, not verified |
| Targeted organization/schema rerun | 33 passed, zero failures | Single-session engine |
| Frontend | 121 passed, zero failures/skips | Pure/helper suite |
| Production frontend build | Passed | Live backend/device flow is separate |

Passing test output was scanned for synthetic password/token/photo canaries; no matches. The three logging regressions and updated orphan-cleanup test also capture/assert output directly. Native concurrency and live provider/device checks remain pending.


## Native PostgreSQL sign-off (2026-10-28, task 5.2 closed)

Environment: PostgreSQL 16 installed with apt, run as the postgres user on port 5433 (database `natra_test`, name contains "test"), Node 22.22. Command: `TEST_DATABASE_URL=... npm --prefix backend test` (serial, `--test-concurrency=1`).

| Run | Result |
|---|---|
| First native run | 517 tests: 515 pass, **2 fail**, 0 skipped |
| After two test-only fixes | 517 tests: **517 pass, 0 fail, 0 skipped, 0 todo** |
| Frontend | 121 pass, 0 fail |

The 12 native multi-connection cases previously excluded from the embedded sweep (simultaneous scans, row-lock wait, concurrent corrections, deduction contention, leave requests/approvals, payroll create/approve/pay) ran in this suite and passed.

Failures found and why they were test issues:
1. `attendanceScan.test.js` "late minutes match the stored check-in time": the test computed the expected minutes from `check_in_at` with fractional seconds, but the classifier (and the documented rule) works in whole seconds. When the check-in fell in the first second after a minute boundary the two differed by one (1372 vs 1373). Test now floors seconds. Product code unchanged; 1-in-60 flaky by clock time before the fix.
2. `schema.test.js` seeded-row assertion saw 8%/9% instead of 5%/10%: `payroll_settings` is a seed row that TRUNCATE_ALL keeps, and `payrollSettings.test.js` reset it only before each test, so the last test's values leaked into the later file. Its `after` hook now restores the defaults.

Log check: synthetic credential values (session secret, HR seed password, a database URL with password) were searched for in the full native test output and the API dev log; zero matches.

Not covered: Neon (pooler/TLS), Node 24, Render, live Cloudinary, real devices.
