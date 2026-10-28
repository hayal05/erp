# Startup migration and memory check — task 5.5 (spec §23, < 512 MB)

Run 2026-10-28 against a **native PostgreSQL 16 server** (apt, started as the `postgres` user on port 5433), the unmodified four migrations and the production code path (`NODE_ENV=production`). Node v22.22.2 here; Render pins 24 (`.node-version`).

## Startup migration (Render start command shape)

`DATABASE_URL="$MIGRATION_DATABASE_URL" node backend/src/db/migrate.js && node backend/src/server.js`

| Check | Result |
|---|---|
| Empty database | Applies 001–004 in order, exits 0 |
| Second run (every deploy/restart) | `database is up to date`, exits 0, no changes |
| Two migrators started at the same moment on an empty database (two instances) | One applied all four, the other waited on the advisory lock and reported up to date; both exit 0; `schema_migrations` has exactly 4 rows |
| An applied migration whose checksum no longer matches | Migrator exits 1 (`[migration] failed (internal_error)`), the `&&` stops the start command, **no server is listening**; no SQL text or credentials in the output |
| Seed after migrate | HR admin created |

The migrator is a separate short-lived process, so its memory is released before the API starts.

## Memory (VmRSS / VmHWM read from `/proc/<node pid>/status`)

| Moment | RSS | Peak so far |
|---|---|---|
| Just booted, no request yet | 71.2 MB | 71.9 MB |
| Idle 15 s after one `/health` | 68.0 MB | 73.3 MB |
| After 30 s, 20 concurrent clients cycling 8 endpoints (10,520 requests, all 200) | 110.9 MB | 110.9 MB |
| After 200 bcrypt logins, 10 in parallel (all 200) | 82.1 MB | 112.2 MB |
| After 20 s with 60 concurrent clients (all 200) | 111.5 MB | **112.2 MB** |
| Idle 10 s later | 111.5 MB | 112.2 MB |

Endpoints in the load mix: `/health`, `/api/auth/me`, `/api/employees`, `/api/dashboard`, `/api/payroll/periods`, `/api/departments`, `/api/shifts`, `/api/leave-admin/requests`.

**Peak 112 MB against a 512 MB limit (about 22%).** RSS stays high after load because V8 keeps freed heap; it did not grow between the 20-client and 60-client phases, which points to no leak at this scale.

## Not covered (be honest in the report)

- Tiny dataset: only the seeded admin, no employees/attendance/payroll rows, so list and dashboard queries returned near-empty pages. Memory with a real company's data is not measured.
- Selfie scan path (larger body parse + Cloudinary upload) not exercised: no Cloudinary credentials here.
- Local PostgreSQL, not Neon: the pooled-versus-direct URL split and `sslmode=require` are untested.
- Node 22, not 24, and not a Render free instance (shared CPU, container memory accounting). Re-check RSS in the Render dashboard after first deploy.
- Peak figures are from `VmHWM`, which counts resident memory only, not the container's page cache.

## Reproduce

Start PostgreSQL, set the variables in `.env.example`, then boot the API with the start command above and read `VmRSS`/`VmHWM` from the Node process id (not the wrapping shell). Drive load with any HTTP client that logs in once and reuses the session cookie.
