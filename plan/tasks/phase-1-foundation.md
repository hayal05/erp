# Phase 1: Foundation  (est. ~1,050 LOC)

Format: **Read** = reference to open first · **Open** = files to create/edit · **Done when** = acceptance check.


## Day 1: Skeleton and server

### 1.1 Create monorepo folders, both package.json files, .env.example
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §2, §24
- **Open:** `package.json (root/frontend/backend), .env.example`
- **Done when:** `npm install` works in both packages

### 1.2 server.js: config loader, /health, error handler
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §23
- **Open:** `backend/src/server.js, backend/src/config.js`
- **Done when:** `GET /health` returns 200

### 1.3 pg pool (max 5) and SQL migration runner
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §2, §23
- **Open:** `backend/src/db/pool.js, backend/src/db/migrate.js`
- **Done when:** `npm run migrate` applies files once, in order

### 1.4 Migration 001: users, sessions (locked column), departments, shifts, employees, audit_logs
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §21
- **Open:** `database/migrations/001_core.sql`
- **Done when:** Migration runs clean on Neon/local Postgres


## Day 2: Auth backend

### 1.5 Password hashing and seed-HR-admin script
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §22
- **Open:** `backend/src/services/password.js, backend/src/db/seed.js`
- **Done when:** Seeded admin can be verified with hash check

### 1.6 pg-backed server sessions, HTTP-only cookies
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §6.3, §22
- **Open:** `backend/src/middleware/session.js`
- **Done when:** Cookie is HttpOnly/SameSite; session row created

### 1.7 CSRF protection (session-bound synchronizer token + Origin check)
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §22
- **Open:** `backend/src/middleware/csrf.js`
- **Done when:** POST without token returns 403

### 1.8 Login, logout, me routes with login rate limiter
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §22
- **Open:** `backend/src/routes/auth.js, backend/src/middleware/rateLimit.js`
- **Done when:** Wrong password x N is throttled


## Day 3: Guards and frontend base

### 1.9 requireAuth, requireRole middleware and audit-log helper
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §3, §22
- **Open:** `backend/src/middleware/auth.js, backend/src/services/audit.js`
- **Done when:** Employee gets 403 on an HR route; audit row written

### 1.10 Request-validation helper
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §22
- **Open:** `backend/src/middleware/validate.js`
- **Done when:** Bad payload returns 400 with field errors

### 1.11 Vite, React Router, API client (CSRF header), auth context
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §2, §24
- **Open:** `frontend/src/api/client.js, frontend/src/App.jsx, frontend/src/main.jsx`
- **Done when:** Client sends CSRF token; auth state loads from /me

### 1.12 Login page
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §20
- **Open:** `frontend/src/pages/Login.jsx`
- **Done when:** HR and employee can log in and land on correct area


## Day 4: Employees and layout

### 1.13 Shared components: table, form fields, modal, button, toast + theme CSS variables (dark/light)
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §20, references/ui-notes.md
- **Open:** `frontend/src/components/*, frontend/src/styles.css`
- **Done when:** Components render in both themes

### 1.14 HR layout: top bar, sidebar, route guard
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §4, references/ui-notes.md
- **Open:** `frontend/src/components/HrLayout.jsx`
- **Done when:** Sidebar matches the 7 menu items; guard redirects employees

### 1.15 Employees, departments, shifts APIs (paginated, no hard delete)
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §9
- **Open:** `backend/src/routes/employees.js, departments.js, shifts.js`
- **Done when:** CRUD + deactivate works; list is paginated

### 1.16 Employees page, form dialog, employee portal shell (mobile-first)
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §9, §20
- **Open:** `frontend/src/pages/Employees.jsx, frontend/src/pages/portal/PortalLayout.jsx`
- **Done when:** HR adds/edits employee; portal shell loads on phone width

### 1.17 Tests: login, role isolation, employee denied HR routes
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §26 #1
- **Open:** `backend/tests/auth.test.js`
- **Done when:** Test 1 passes
