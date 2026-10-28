# Natra ERP

HR, QR-selfie attendance, leave and payroll for a company of about 50 people. One web app, two roles (HR Administrator and Employee), no kiosk app: the office tablet is just a normal HR login with a locked QR screen.

| Part | Tech |
|---|---|
| Frontend (`frontend/`) | React + Vite, plain CSS, React Router |
| API (`backend/`) | Node 24 + Express, server-side sessions in HTTP-only cookies, hand-written SQL via `pg` |
| Database (`database/migrations/`) | PostgreSQL (Neon in production), plain SQL migrations |
| Selfies | Cloudinary, private (`authenticated`) storage, signed expiring links |
| Hosting | Render (static site + free web service), UptimeRobot for keep-alive |

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
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`: the first HR login (password: 10+ characters).
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

1. Sign in as HR on a tablet (or a second browser window) → **QR Attendance** → **Generate New QR**. Codes live 45 seconds and work once. **Lock** hides the rest of the HR interface for that session until HR re-enters their password.
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
| `FRONTEND_URL` | API | The exact browser origin of the site, no path (e.g. `https://natra-erp-web.onrender.com`). Used for CORS, CSRF Origin checks and cookies. |
| `COOKIE_SAMESITE` | API | `lax` locally or on sibling custom domains; `none` for two separate `*.onrender.com` hosts (cookie is then also `Secure`). |
| `COMPANY_NAME`, `COMPANY_TIMEZONE` | API | Shown on the QR page; the timezone decides work dates and lateness (default `Africa/Addis_Ababa`). |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | API only | Selfie storage. Blank = app boots, selfie scans return 503. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | one-off | Only read by the seed script. Never stored in Render. |
| `VITE_API_URL` | frontend build | Public API origin, no trailing `/api`. Baked into the bundle at build time; only `VITE_` values reach the browser. |
| `TEST_DATABASE_URL` | tests | Disposable database, name must contain `test`. |

`PORT` is supplied by Render. `NODE_ENV=production` is set by the Blueprint. Do not put `NODE_ENV` in your local `.env`.

---

## 4. Deploy to Render + Neon + Cloudinary

`render.yaml` defines both services: `natra-erp-api` (free Node web service, health check `/health`) and `natra-erp-web` (static site, with a rewrite of every path to `index.html`). Automatic redeploy on commit is **off**; deploy manually from the Render dashboard.

### 4.1 Accounts and secrets

1. **Neon:** create a project and database. From the connection details copy **two** URLs for the same database: the *pooled* one (host contains `-pooler`) and the *direct* one. Both need `sslmode=require`.
2. **Cloudinary:** note the cloud name, API key and API secret (Dashboard → API Keys).
3. **Git:** push this folder so that its root (the one containing `render.yaml`, `backend/`, `frontend/`, `database/`) is the repository root. Do not set a different root directory in Render: the API needs `database/migrations` next to `backend/`.

### 4.2 Create the services

1. Render → **New → Blueprint** → pick the repository. Render reads `render.yaml`.
2. Fill in the prompted secrets for `natra-erp-api`:
   - `DATABASE_URL` = Neon **pooled** URL
   - `MIGRATION_DATABASE_URL` = Neon **direct** URL
   - `FRONTEND_URL` = the static site's final HTTPS origin. Render shows the URL only after creation, so enter a placeholder, then come back (step 4).
   - the three `CLOUDINARY_*` values
3. Let both services build. On every API start the command first applies pending migrations using the direct URL and only then starts the API; a failed or tampered migration stops the start.
4. Copy the static site's URL (e.g. `https://natra-erp-web.onrender.com`) into the API's `FRONTEND_URL`, save, and **redeploy the API**. If `VITE_API_URL` changed, **redeploy the static site** too, because it is baked in at build time.
5. Open `https://<api>/health`: expect `{"status":"ok"}`.

### 4.3 Create the first HR administrator (once)

Render's free tier has no shell, so seed from your own machine against Neon. Use the direct URL; shell variables override `.env`:

```bash
DATABASE_URL='<neon direct url>' \
SEED_ADMIN_EMAIL='hr@yourcompany.com' \
SEED_ADMIN_PASSWORD='<a strong password, 10+ chars>' \
SEED_ADMIN_NAME='HR Administrator' \
npm --prefix backend run seed
```

Run it once. Do not put these `SEED_ADMIN_*` values into Render, and do not seed on every deploy. Then sign in at the static site's URL and change nothing else until Settings is configured.

### 4.4 Cookies and the two-host caveat

The two default `*.onrender.com` hosts are *cross-site*, so the session cookie is `SameSite=None; Secure` (the Blueprint sets this). Some browsers or privacy settings block such third-party cookies, and then login appears to succeed but the next request is signed out. **For dependable sessions, use two custom domains under one registrable domain** (for example `app.yourcompany.com` and `api.yourcompany.com`), then in `render.yaml` set `COOKIE_SAMESITE` to `lax`, set `FRONTEND_URL` to the app origin, make `VITE_API_URL` the API origin, and redeploy both. Do not set a cookie `Domain` and do not move tokens into `localStorage`. Test login on the actual phones and tablet you will use.

Details and the full per-service variable matrix: `plan/references/render-configuration.md`.

---

## 5. UptimeRobot (keep the free API awake)

A free Render web service sleeps after a period without traffic, and the first request after that is slow. A monitor that pings `/health` regularly avoids this, and also alerts you if the API is down. `/health` does not touch the database, so frequent pings are cheap.

1. Create a free account at uptimerobot.com → **Add New Monitor**.
2. Monitor type **HTTP(s)**, URL `https://<your-api>.onrender.com/health`, friendly name e.g. "Natra API".
3. Interval **5 minutes** (the shortest the free plan offers; check current limits). Add your email as an alert contact.
4. Optionally add a second monitor for the static site's URL.

Check Render's current free-tier rules before relying on this, as they change. If you outgrow it, a paid Render instance removes the sleep behaviour.

---

## 6. Project layout

```
natra-erp/
├── backend/        Express API: src/{routes,services,middleware,db}, tests/, scripts/
├── frontend/       React app: src/{components,pages,api}, tests/
├── database/migrations/   001 core · 002 attendance · 003 leave · 004 payroll
├── plan/           task list, decisions, session notes, test evidence
├── loc-report.md   actual size of the code base and how it was counted
├── render.yaml     Render Blueprint (API + static site)
└── .env.example    every setting, documented
```

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

The last query should list the four migration files (`001_core.sql` to `004_payroll.sql`). Then set `DATABASE_URL` (pooled) and `MIGRATION_DATABASE_URL` (direct) in Render to the new database and redeploy the API. The start command runs the migrator first; because the dump includes the applied-migration records with their checksums, it should report nothing to apply. The dump also contains the extension the leave tables need (`btree_gist`); if the target refuses it, tell your database host.

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
- Size: 14,343 lines of code including 7,147 of tests (production code alone 7,196), against a budget of 9,000: over budget when tests count. See `loc-report.md`.
- MVP shifts are same-day only (a shift cannot cross midnight).
- Backups, selfie retention/deletion, the manual attendance fallback and the same-day-shift limit are documented in section 7. Those procedures are written from the code and standard tooling; none was run against a real Neon/Cloudinary account.
