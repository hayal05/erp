# Payroll verification — task 4.22

Run from `backend/` after `npm ci`:

```sh
npm run test:payroll
```

This runs the payroll unit/service tests and `payrollEmbedded.test.js`. The embedded suite uses PGlite (PostgreSQL compiled to WebAssembly) with `btree_gist`, applying **all four original migrations unchanged** to an isolated in-memory database. It exercises the real Express app, login/session/CSRF middleware, payroll SQL, triggers, transactions and employee ownership predicates. Only the database pool is adapted inside its isolated Node test worker; application code and production database configuration are unchanged. No external database is opened by that worker.

| Required check | Runnable coverage |
|---|---|
| #1 employee cannot access others' salary | Embedded HTTP tests: draft hidden; other employee IDs 404; employee/user query spoofing ignored; HR salary/payroll/detail/export/dashboard endpoints 403; all-employee snapshot absent from own payslip |
| #12 correct tax bracket | `payrollEngine.test.js`, `payrollSchemas.test.js` |
| #13 employee vs company pension | Engine tests plus embedded saved entry/payslip checks |
| #14 flat deductions summed | Engine tests and embedded one-time/recurring deduction workflows |
| #15 correct net salary | Engine/service assertions and embedded stored entries |
| #16 approved payroll cannot be recalculated | Embedded HTTP edits 409; database entry/item writes, period deletion/snapshot change/status reversal blocked; paid history remains locked |
| #17 history unchanged after configuration changes | Embedded snapshot/entries/detail/payslip/CSV comparisons after bracket, pension, profile, tax and recurring deduction source edits; next draft uses new inputs |

The embedded suite also checks stale-approval refusal, transaction rollback on audit failure, partial-generation rollback, one-time deductions across periods, repeated attendance recalculation, dashboard SQL and exact-month filtering.

## External PostgreSQL checks still required

PGlite is single-session. It does **not** prove multi-connection row-lock waiting, deadlock/serialization behavior, concurrent generation/approval/payment, connection-pool behavior or production TLS. Those tests remain in `payroll.test.js`, `deductions.test.js`, `schema.test.js` and the other database suites.

Run the full backend suite with `TEST_DATABASE_URL` set to a dedicated PostgreSQL test database whose name contains `test`:

```sh
npm test
```

The database suites truncate test data. Do not use a database containing data you need to keep. Without `TEST_DATABASE_URL`, they are skipped; the embedded suite still runs. Phase 5 must run the full server-backed suite and the live-API/device checkpoints before treating the project as deployment-ready.


The embedded file now also contains the lock/token/photo coverage added by task 5.1. See `required-tests.md` for the full 17-requirement map and remaining native/device checks.
