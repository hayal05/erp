# Natra ERP

HR, QR-selfie attendance, leave and payroll for a company of about 50 people. One web app, two roles (HR Administrator and Employee), no kiosk app: the office tablet is just a normal HR login with a locked QR screen.

| Part | Tech |
|---|---|
| Frontend (`frontend/`) | React + Vite, plain CSS, React Router |
| API (`backend/`) | Node 24 + Express, server-side sessions in HTTP-only cookies, hand-written SQL via `pg` |
| Database (`database/migrations/`) | PostgreSQL (Neon in production), plain SQL migrations |
| Selfies | Cloudinary, private (`authenticated`) storage, signed expiring links |
| Hosting | Render: one free web service (the API also serves the built frontend, one URL), UptimeRobot for keep-alive |

The plan, task list, decisions and per-feature notes are in `plan/`. Start with `plan/project status.md`.

---

## 1. Run it locally

**You need:** Node 20.6 or newer (tested on 22; production pins 24, see `.node-version`), npm, and a PostgreSQL 14+ server you can create a database on. Cloudinary is optional locally: without it the app boots and everything works except taking and viewing selfies.

```bash
# 1. Install both apps
npm run install:all

# 2. Create an empty database (any name; this example matches .env.example)
createdb natra            # or: psql -c 'CREATE DATABASE natra'

# 3. Configure
cp .env.example .env
```

Edit `.env` (it lives at the **repository root**; the backend and Vite both read it):

- `DATABASE_URL`: your local PostgreSQL URL.
- `SESSION_SECRET`: required, at least 32 characters. Generate one with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`: the first Admin login (password: 10+ characters). `SEED_ADMIN_EMAIL` is optional contact information; if username is omitted, the seed script uses that email as the username for compatibility.
- Leave `FRONTEND_URL=http://localhost:5173`, `VITE_API_URL=http://localhost:4000` and `COOKIE_SAMESITE=lax` as they are for local work.

```bash
# 4. Create tables, then the first HR administrator
npm run migrate
npm --prefix backend run seed

# 5. Start the API (port 4000) and, in a second terminal, the frontend (port 5173)
npm run dev:backend
npm run dev:frontend
```

Open <http://localhost:5173> and sign in with the seeded HR account. Check the API directly with `curl http://localhost:4000/health` (returns `{"status":"ok"}`).

Notes:

- The frontend port is fixed. The API's CORS and CSRF checks allow exactly `FRONTEND_URL`, so Vite refuses to move to another port.
- `npm run migrate` is safe to run again: applied migrations are skipped, and a migration file that was edited after being applied is refused.
- Lost the HR password? `npm --prefix backend run seed -- --reset-password` (uses the `SEED_ADMIN_*` values, signs that user out everywhere). There is no email reset flow.
- First steps once signed in: Settings → add a **working schedule** (a "Standard" 09:00–17:00 Mon–Fri shift is seeded), add holidays, then Employees → Add employee (HR sets the first password). For payroll, fill in Settings → Payroll settings (income-tax brackets, pension) and each employee's salary profile. Nothing statutory is pre-filled; the seeded defaults are illustrative.

### Trying the QR attendance flow

1. Sign in as HR on a tablet (or a second browser window) → **QR Attendance** → **Generate New QR**. Codes live 45 seconds and can be used by all employees during that window, once per employee. A repeat with the same code cannot check that employee out; check-out requires a new code. Generating again expires the previous code from that HR session. **Lock** hides the rest of the HR interface for that session until HR re-enters their password.
2. An employee opens the code with their own phone, signs in if asked, takes a front-camera selfie and submits. The first scan of a day is a check-in, the second a check-out.
3. Browsers only give camera access on **HTTPS** (or `localhost`). A phone on your Wi-Fi cannot use `http://192.168...`; use the deployed HTTPS site or an HTTPS tunnel for real device checks.

---

## 2. Tests and builds

```bash
npm test                  # backend + frontend suites
npm run build             # validates the backend, builds frontend/dist
```

Without a database, database-backed tests are skipped (the run still passes). To run them, create a **separate disposable database whose name contains `test`** and point at it. The tests truncate tables and refuse to run against any other name:

```bash
createdb natra_test
TEST_DATABASE_URL=postgresql://natra:password@127.0.0.1:5432/natra_test npm --prefix backend test
```

Useful subsets (run from the repository root):

| Command | What it covers |
|---|---|
| `npm --prefix backend run test:required-local` | The spec's required checks that run without an external database |
| `npm --prefix backend run test:payroll` | Payroll engine, workflow, CSV and payslip tests |
| `npm --prefix backend run test:db-embedded` | Database tests on an in-process PostgreSQL engine (no server needed; does not cover multi-connection races) |
| `npm --prefix backend run check:production` | Boots the real API in production mode with temporary credentials |
| `node --env-file=.env backend/scripts/cloudinary-smoke.js` | Manual check against your real Cloudinary account that selfies are private |

`plan/references/required-tests.md` maps each of the 17 required checks to exact test names.

---

## 3. Environment variables

All variables are documented, with comments, in `.env.example`. Summary:

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | API | PostgreSQL URL. On Render: Neon's **pooled** URL, `sslmode=require`. |
| `MIGRATION_DATABASE_URL` | API (Render) | Neon's **direct** (non-pooler) URL for the **same** database. Migrations take a session advisory lock, which Neon's pooler does not support. |
| `SESSION_SECRET` | API | 32+ characters. Render generates it. The app refuses to start in production without it. |
| `FRONTEND_URL` | API | The exact browser origin, no path. Local dev: `http://localhost:5173` (Vite). On Render it is **optional**: it defaults to the service's own `RENDER_EXTERNAL_URL`. Set it only if you use a custom domain. Used for CORS and CSRF Origin checks. |
| `COOKIE_SAMESITE` | API | `lax` (default, and what the Blueprint sets: app and API share one origin). `none` is only for a legacy split deployment of two cross-site hosts. |
| `COMPANY_NAME`, `COMPANY_TIMEZONE` | API | Shown on the QR page; the timezone decides work dates and lateness (default `Africa/Addis_Ababa`). |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | API only | Selfie storage. Blank = app boots, selfie scans return 503. |
| `SEED_ADMIN_USERNAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | one-off | Only read by the seed script. Never stored in Render. |
| `VITE_API_URL` | frontend build | Local dev only (`http://localhost:4000`). **Leave unset on Render**: empty means the frontend calls the same origin it was loaded from. Baked in at build time; only `VITE_` values reach the browser. |
| `TEST_DATABASE_URL` | tests | Disposable database, name must contain `test`. |

`PORT` is supplied by Render. `NODE_ENV=production` is set by the Blueprint. Do not put `NODE_ENV` in your local `.env`.

---

## 4. Deploy to Render + Neon + Cloudinary

`render.yaml` defines **one** service, `natra-erp` (free Node web service, health check `/health`). Its build step builds the frontend, and in production the Express server serves `frontend/dist` (every non-API path falls back to `index.html`) next to the `/api` routes, so the whole app lives at a single URL. Automatic redeploy on commit is **off**; deploy manually from the Render dashboard.

### 4.1 Accounts and secrets

1. **Neon:** create a project and database. From the connection details copy **two** URLs for the same database: the *pooled* one (host contains `-pooler`) and the *direct* one. Both need `sslmode=require`.
2. **Cloudinary:** note the cloud name, API key and API secret (Dashboard → API Keys).
3. **Git:** push this folder so that its root (the one containing `render.yaml`, `backend/`, `frontend/`, `database/`) is the repository root. Do not set a different root directory in Render: the API needs `database/migrations` next to `backend/`.

### 4.2 Create the services

1. Render → **New → Blueprint** → pick the repository. Render reads `render.yaml`.
2. Fill in the prompted secrets for `natra-erp`:
   - `DATABASE_URL` = Neon **pooled** URL
   - `MIGRATION_DATABASE_URL` = Neon **direct** URL
   - the three `CLOUDINARY_*` values
3. Let the service build. On every start the command first applies pending migrations using the direct URL and only then starts the server; a failed or tampered migration stops the start.
4. Open `https://<your-service>.onrender.com/health`: expect `{"status":"ok"}`. Open the root URL for the app. No second URL, placeholder or redeploy is needed.

### 4.3 Create the first HR administrator (once)

Render's free tier has no shell, so seed from your own machine against Neon. Use the direct URL; shell variables override `.env`:

```bash
DATABASE_URL='<neon direct url>' \
SEED_ADMIN_EMAIL='hr@yourcompany.com' \
SEED_ADMIN_PASSWORD='<a strong password, 10+ chars>' \
SEED_ADMIN_NAME='HR Administrator' \
npm --prefix backend run seed
```

Run it once. Do not put these `SEED_ADMIN_*` values into Render, and do not seed on every deploy. Then sign in at the service's URL and change nothing else until Settings is configured.

### 4.4 Cookies, custom domain and the one-URL design

Because the app and API share one origin, the session cookie is first-party (`SameSite=Lax`, `Secure`, `__Host-` prefix) and the third-party-cookie problem of a split deployment does not exist. The API's CORS and CSRF Origin checks compare against the service's own origin automatically (`RENDER_EXTERNAL_URL`).

If you attach a **custom domain** (for example `erp.yourcompany.com`), add an environment variable `FRONTEND_URL=https://erp.yourcompany.com` to the service (exact origin, no path), because users then reach the app on a different origin than `RENDER_EXTERNAL_URL`. Keep it in `render.yaml` too, since Blueprint sync can overwrite dashboard-only settings. Do not set a cookie `Domain` and do not move tokens into `localStorage`. Test login on the actual phones and tablet you will use.

The server sends a Content-Security-Policy for the app's pages: scripts only from the same origin plus the one inline theme script (allowed by hash, computed from the built `index.html`), images from the same origin, `data:`/`blob:` (QR code, selfie preview) and Cloudinary (signed selfie links). If you add a new external image, font or script host, extend it in `backend/src/middleware/frontend.js`.

Details and the full per-service variable matrix: `plan/references/render-configuration.md`.

---

### 4.5 Deploying a release that adds a migration (migration 005, Departments and positions)

Migration `005_positions.sql` is **additive**: it adds a `positions` table and one nullable column, `employees.position_id`. It does not rewrite or delete any existing row, and no payroll table is touched. Even so, it changes a live database, so:

1. **Take a backup first:** a Neon branch of the production database (check Neon's current documentation for how) and/or a `pg_dump` as in section 7.1. This is the way back if anything surprises you; do not skip it.
2. **Record the approved payroll totals before the deploy** (direct Neon URL):

   ```bash
   psql "<neon direct url>" -At -F ' | ' -c "
     SELECT to_char(p.period_month, 'YYYY-MM'), p.status, count(*), sum(e.gross_minor), sum(e.net_minor)
     FROM payroll_periods p JOIN payroll_entries e ON e.period_id = p.id
     WHERE p.status IN ('approved', 'paid')
     GROUP BY p.period_month, p.status ORDER BY p.period_month;" > payroll-before.txt
   ```

3. **Deploy once** from the Render dashboard. The start command applies `005` automatically before the server starts; if the migration fails the service does not start (and the previous deploy keeps running).
4. **Run the same query again** into `payroll-after.txt` and compare: `diff payroll-before.txt payroll-after.txt` must print nothing. (Approved periods are also protected by database triggers; this is a second, independent check.) Check that `SELECT filename FROM schema_migrations ORDER BY 1;` lists five files.
5. Open Departments in the app and add a department and a position as a smoke test.

The schema change is backwards compatible, so an older version of the app should keep running on the new schema (it ignores the new table and column); this was not tested. Not verified here: the migration on Neon itself (it was applied and re-applied on a local PostgreSQL 16 server, including onto a database that already held employees and a salary profile).

---

## 5. UptimeRobot (keep the free service awake)

A free Render web service sleeps after a period without traffic, and the first request after that is slow. Since the web app is served by this same service, a sleeping service also means a slow first page load, so the keep-alive matters more than in a split deployment. A monitor that pings `/health` regularly avoids this, and also alerts you if the API is down. `/health` does not touch the database, so frequent pings are cheap.

1. Create a free account at uptimerobot.com → **Add New Monitor**.
2. Monitor type **HTTP(s)**, URL `https://<your-service>.onrender.com/health`, friendly name e.g. "Natra ERP".
3. Interval **5 minutes** (the shortest the free plan offers; check current limits). Add your email as an alert contact.

Check Render's current free-tier rules before relying on this, as they change. If you outgrow it, a paid Render instance removes the sleep behaviour.

---

## 6. Project layout

```
natra-erp/
├── backend/        Express API: src/{routes,services,middleware,db}, tests/, scripts/
├── frontend/       React app: src/{components,pages,api}, tests/
├── database/migrations/   001 core · 002 attendance · 003 leave · 004 payroll · 005 positions
├── plan/           task list, decisions, session notes, test evidence
├── loc-report.md   actual size of the code base and how it was counted
├── render.yaml     Render Blueprint (one service: API + built frontend)
└── .env.example    every setting, documented
```

### 6.1 Departments, positions and default salaries (HR guide)

HR sidebar: **Departments**, right after Employees. Add a department there, then open it to manage its **positions**.

- **A position** is a job inside one department with a default monthly salary: basic salary, one allowance (with "taxable" and "pensionable" flags) and a pension flag. These are the same five fields as an employee's salary, so the package copies across unchanged.
- **New employee:** choose the department, then a position. The form shows the salary the position gives; saving the employee also saves that salary, in one step (if either fails, neither is saved). The job title becomes the position name. With no position, nothing changes from before: no salary is created until HR sets one with the **Salary** button.
- **Changing an employee's position:** the form shows the **current salary beside the new position's salary** and a checkbox, **Apply new position salary**, checked by default. Unchecking it keeps the current salary (for exceptional cases). Removing a position keeps the salary and the last job title.
- **A position is a template, copied when it is assigned.** Editing a position's salary never changes employees who already have it, and a salary edited by hand for one employee (Salary button) is that person's exception only. Renaming a position does update the job title of the employees on it (their salaries are untouched).
- **Existing employees are not moved automatically.** Assign positions by hand, one by one; until then they keep their free-text job title and their salary.
- **Payroll:** a salary change affects **draft** payrolls only. Approved and paid payrolls keep their saved amounts; payroll calculation itself is unchanged.
- **Guards:** a position held by any employee (active or not) cannot be deleted; a department with positions or employees cannot be deleted; a position must belong to the employee's department. Every change is written to the audit log (`position.*`, `department.*`, and the salary change with the position it came from).

## 7. Operations guide

Four things an operator needs once the system is live: backups, selfie retention and deletion, what to do when QR attendance is unavailable, and the same-day-shift limit.

### 7.1 Backups

**What lives where.** Everything except selfies is in the PostgreSQL database (employees, attendance, leave, payroll, audit log). Selfies are only in Cloudinary; the database stores just their random IDs. A database backup therefore does **not** contain photos. Losing the photos leaves attendance rows intact but with no viewable selfie.

**Two layers.**

1. *Provider history (Neon).* Neon keeps a rolling change history that can restore a past point in time or branch from it. How far back depends on your plan, and the free plan's window is short, so read Neon's current documentation and do not treat this as your only backup.
2. *Your own dumps (recommended).* A logical dump you control, kept outside Render and Neon. From a developer machine, using the Neon **direct** URL (the same one as `MIGRATION_DATABASE_URL`):

```bash
pg_dump --format=custom --no-owner --no-privileges \
  "<neon direct url>" --file "natra-$(date +%F).dump"
```

Use a `pg_dump` whose major version is at least the server's. Suggested rhythm (a suggestion, not a requirement): weekly, plus one **immediately before approving each month's payroll** and before any deploy that adds a migration. Keep for example the last 4 weekly dumps and 12 monthly ones.

**Treat every dump as sensitive.** It contains salaries, tax data, password hashes, session hashes and personal details. Store it encrypted, restrict who can read it, and delete old copies on a schedule. Backups also count when you apply a data-retention rule.

**Restore into a new, empty database. Never restore over the live one.**

```bash
# 1. Create an empty database (a new Neon branch or database) and copy its direct URL.
# 2. Load the dump:
pg_restore --no-owner --dbname "<new direct url>" natra-2026-10-28.dump
# 3. Check it:
psql "<new direct url>" -c "SELECT count(*) FROM employees;" \
                        -c "SELECT count(*) FROM payroll_periods;" \
                        -c "SELECT filename FROM schema_migrations ORDER BY 1;"
```

The last query should list the five migration files (`001_core.sql` to `005_positions.sql`). Then set `DATABASE_URL` (pooled) and `MIGRATION_DATABASE_URL` (direct) in Render to the new database and redeploy the API. The start command runs the migrator first; because the dump includes the applied-migration records with their checksums, it should report nothing to apply. The dump also contains the extension the leave tables need (`btree_gist`); if the target refuses it, tell your database host.

Things to know after a restore:

- Sessions are stored as keyed hashes. If you also change `SESSION_SECRET`, everyone is signed out and must log in again (harmless). Unexpired QR codes are void either way after 45 seconds.
- Rows written after the dump are gone. Attendance can be re-entered by HR (section 7.3); leave and payroll actions since the dump must be repeated by hand.
- Do a **restore drill once** before you rely on this (restore the latest dump into a scratch database and run the three checks above).

> Not verified here: these commands are standard PostgreSQL tooling, but no restore against Neon was run in the build environment (no network access and no PostgreSQL client tools there). Run the drill yourself.

### 7.2 Selfie retention and deletion

The spec requires a deletion procedure for photos but sets no retention period. **Choose one with your HR/legal advisers** and check local data-protection rules; a common starting point is to keep selfies only as long as disputes about a day's attendance are plausible (for example 12 months). Payroll and attendance rows are separate and are *not* deleted by any of this.

What the system guarantees: selfies are private in Cloudinary (signed links, 5 minutes, every view audited), and a photo is uploaded only for a scan that is then recorded. The application has no delete button, so retention is a manual, periodic job.

**A. Delete all selfies older than a cutoff date** (here `2025-01-01`; choose yours). Run from a developer machine with the repository's `.env` containing the real `CLOUDINARY_*` values.

```bash
# 1. List the photo IDs to delete (direct Neon URL; one ID per line).
psql "<neon direct url>" -At -c "
  SELECT check_in_photo_id  FROM attendance_records WHERE work_date < DATE '2025-01-01' AND check_in_photo_id  IS NOT NULL
  UNION ALL
  SELECT check_out_photo_id FROM attendance_records WHERE work_date < DATE '2025-01-01' AND check_out_photo_id IS NOT NULL
" > old-photos.txt
wc -l old-photos.txt

# 2. Delete them from Cloudinary using the app's own delete function
#    (idempotent: an already-deleted photo counts as success, so a rerun is safe).
cd backend
node --env-file=../.env --input-type=module -e "
import fs from 'node:fs';
import { photos } from './src/services/cloudinary.js';
const ids = fs.readFileSync('../old-photos.txt', 'utf8').split('\n').filter(Boolean);
for (const id of ids) await photos.delete(id);
console.log('deleted', ids.length);
"
cd ..

# 3. Only after step 2 finished without error, clear the references and record it.
psql "<neon direct url>" <<'SQL'
BEGIN;
UPDATE attendance_records SET check_in_photo_id = NULL, check_out_photo_id = NULL
 WHERE work_date < DATE '2025-01-01';
INSERT INTO audit_logs (action, entity_type, reason, details)
VALUES ('attendance.photo_purge', 'attendance_record', 'Retention: selfies before 2025-01-01',
        jsonb_build_object('before', '2025-01-01'));
COMMIT;
SQL
```

Never do step 3 before step 2: once the IDs are cleared from the database you lose the list of what to delete. If step 2 stops halfway, run it again. After step 3 the HR attendance page simply shows no selfie button for those days. Delete `old-photos.txt` afterwards (it contains private storage IDs).

**B. Delete one person's selfies** (for example on request): the same three steps, with `WHERE employee_id = (SELECT id FROM employees WHERE employee_code = '<their code>')` instead of the date condition, and the reason text changed accordingly. The attendance rows themselves stay.

**C. Orphans.** If a scan fails after the photo was uploaded, the app deletes the photo. If that cleanup also fails, the log contains a line like `[orphan-photo] cleanup failed; reference=e4d68201729d39da`. By design the log never contains the photo ID, only the first 16 hex characters of its SHA-256. To reconcile, list the files under `natra/selfies/` in the Cloudinary Media Library (type *authenticated*), then for each ID that is **not** in the database (`SELECT 1 FROM attendance_records WHERE '<id>' IN (check_in_photo_id, check_out_photo_id)` returns nothing) compute its reference and compare:

```bash
printf '%s' 'natra/selfies/2026/<id>' | sha256sum | cut -c1-16
```

Delete only files whose reference appears in a log line **and** that no attendance row uses. Orphans are rare and harmless apart from storage; a yearly look is enough.

> Not verified here: the deletion function is unit-tested with a fake Cloudinary SDK, and the reference recipe above was checked against the code, but the whole purge has not been run against a real Cloudinary account or database. Try it first with a handful of IDs.

### 7.3 Manual attendance fallback

Use this when the tablet, the QR flow, the camera, Cloudinary or the API is unavailable, or someone could not scan (no phone, dead battery). Scans made while selfie storage is down are rejected with a "not recorded, try again" message, so **no half-recorded attendance** is created.

1. **During the outage:** keep a paper sign-in sheet (name, date, time in, time out), or take a note of times, and tell staff scans will be entered later.
2. **Afterwards**, HR opens **Attendance**, sets the date filter (and employee if needed). For a past day, and for today once the shift has ended, the page creates the missing rows for active employees on their working days; these show as *Absent*.
3. Click **Correct** on the row and set the status (*Present* or *Late*), the **check-in** time and **check-out** time (24-hour, company time zone), and a **reason** (required), for example "QR unavailable, per paper sheet". If the status is *Late* and the minutes are left blank, the system calculates them from the shift, the same way as for a scan.
4. Every correction is stamped with who and when, shown as "Corrected by ..." and written to the audit log with the old and new values. Manual entries have **no selfie**, which is visible as the missing selfie button.

Limits to know:

- The correction screen edits existing rows only. A day that is not a working day for that employee's shift, or a public holiday, has no row and cannot be corrected; today's row does not exist until the shift end time has passed.
- Missing rows are created for at most the last **62 days**, so enter fallback records within that window.
- If payroll for that month is still a **draft** and was already generated, attendance-based deductions may now be out of date: approval will refuse the stale draft until it is reviewed or recalculated. An **approved or paid** payroll never changes.
- This is HR's judgement, not proof of presence. Keep the paper sheet with the reason on file.

### 7.4 Same-day shifts only (MVP limit)

A shift must start and end on the **same calendar day** (end time after start time, enforced in the database and in the form). The work date is the date in the company time zone when the person scans. Consequently:

- Overnight shifts (for example 22:00 to 06:00) **cannot be configured**, and a night worker's scans after midnight would land on the next day, giving wrong late, absence and payroll results. Do not use this version for such staff.
- Lateness is measured from the shift **start**, after the grace period.
- Lifting the limit needs a deliberate change (a shift that ends on the next day, a rule for which date a scan belongs to, and matching changes to late/absence/leave/payroll counting), not a setting.

---

## 8. Status and known gaps

Honest summary of what has and has not been proven (details in `plan/project status.md`):

- Automated tests pass, including the database suites on a real PostgreSQL server. They do not prove a live Render/Neon/Cloudinary setup.
- **Not yet verified:** a real deployment on Render, real Cloudinary privacy (run the smoke script above), cookies across the deployed hosts, and the tablet + phone camera flow on real devices (task 5.9).
- Money is stored in integer minor units (1 ETB = 100). No tax brackets, pension rates or deductions are pre-filled; the values you enter are yours to set.
- Size: 16,145 lines of code including 8,167 of tests (production code alone 7,978), against a budget of 9,000: over budget when tests count. Counted with `plan/references/count-loc.py`, not with cloc. See `loc-report.md`.
- **Departments, positions and default salaries (Phase 6):** the database, API and tests for tasks 6.1 to 6.3 were run against a real PostgreSQL server. Tasks 6.4 to 6.11 (department and employee API changes, their database tests, and the Departments, department detail and employee form pages) were written in an environment with no PostgreSQL and no installable packages: **their tests and the frontend build have not been run, and the new pages have never been opened in a browser.** The whole-flow check on a fresh database and on a phone (task 6.12) is still to do. Run section 2's commands and click through the new pages before relying on them.
- MVP shifts are same-day only (a shift cannot cross midnight).
- Backups, selfie retention/deletion, the manual attendance fallback and the same-day-shift limit are documented in section 7. Those procedures are written from the code and standard tooling; none was run against a real Neon/Cloudinary account.


### Employee usernames and optional contact email

After migration 013, sign in with **Username**, not contact email. HR/Admin enters a
required unique username when registering an employee. Usernames are case-insensitive,
3–254 characters, using letters, numbers and `. _ - @ +` without spaces. Email is
optional contact information and can be changed, removed or shared without changing
login. HR/Finance registration/edits retain the existing approval rules. Only general
Admin can change the username of an account that has privileged access.

The migration copies existing email login names into a separate username column,
so existing credentials keep working. Existing users can continue entering their old
email-shaped username until HR/Admin assigns another username. Changing contact email
does not change that username. No password reset is required by this migration.
The API accepts the old login request's `email` key during rollout, but interprets it
as a username and never looks up contact email.

For new Admin setup, optionally set `SEED_ADMIN_USERNAME`; `SEED_ADMIN_EMAIL` remains
optional contact information. Existing recovery commands that specify only the old
`SEED_ADMIN_EMAIL` still identify that original username. Once a username is changed,
use the current `SEED_ADMIN_USERNAME` for recovery. Do not put seed credentials into
Render or rerun seeding on every deployment.

Pending employee-creation proposals submitted before this schema change may need to
be withdrawn and resubmitted with an explicit username. Run migration 013 before
starting the updated server; the configured Render start command runs migrations.


### Internal vacancies

HR/Admin can post draft or open vacancies, set a closing date, and review applications under **Internal vacancies**. Employees use **Vacancies** in their portal and click **Apply**; no CV, attachment or application text is required. Each employee can apply once per vacancy. Applications save a recruitment-only copy of their profile, experience and position history at submission time; later profile edits do not rewrite the application. HR/Admin can shortlist, select or reject applicants. Selection does not change the employee's position automatically. Finance can view vacancy postings, while applicant profiles and reviews are restricted to HR/Admin.

HR posting/editing and review decisions require another HR reviewer or General Admin through the existing Approvals page. General Admin changes and employee applications are immediate. Vacancy and applicant lists are paginated and participate in navigation-triggered incremental refresh. Migration `015_internal_vacancies.sql` adds the vacancy/application tables; no new environment variables, file storage or background jobs are needed.


The employee Vacancies tab shows a personal count of active, unopened postings. Opening a vacancy's details or applying clears its unread status; loading the list does not. Read receipts persist across devices. Draft, closed, expired and already-applied vacancies do not count. The badge updates on navigation, opening/applying and returning to the app without polling. Migration `016_vacancy_views.sql` adds the read receipts.

### Employee personal details

Gender, Date of birth and Field of study are required for registration and employee editing. Gender accepts only Male/Female (`male`/`female` in the API); birth dates must be real dates on or before the current company date. Field of study is limited to 150 characters. Partial API edits can omit these fields when the saved record is complete, but cannot blank or clear them. Any incomplete imported record must be completed before an administrative edit is applied.

Migration `018_required_employee_personal_details.sql` backfills the two user-supplied records by employee code or username (case-insensitive). It refuses an identifier that matches multiple employees, leaves unrelated records alone, and has nothing to backfill on a fresh installation. Existing nullable storage remains compatible with legacy/imported data; mandatory registration and effective-record validation are enforced by the application.

HR changes retain independent approval; General Admin changes remain immediate. Employees can view these facts in their profile but cannot modify them through self-service. New internal-vacancy applications include the saved facts in the immutable profile snapshot; previously submitted applications keep their original snapshot.

Apply migrations before starting the updated server; the existing Render startup migration command handles this during deployment. No new environment variables are required. Schema/data changes can make pending employee proposals stale; those must be resubmitted.
