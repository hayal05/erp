# Phase 2: QR Attendance  (est. ~1,660 LOC)

Format: **Read** = reference to open first · **Open** = files to create/edit · **Done when** = acceptance check.


## Day 5: Lock enforcement

### 2.1 Migration 002: attendance_tokens, attendance_records (unique employee+work date)
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §21, §8
- **Open:** `database/migrations/002_attendance.sql`
- **Done when:** Duplicate (employee, date) insert is rejected

### 2.2 Lock middleware with allowlist
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §6.1
- **Open:** `backend/src/middleware/lock.js`
- **Done when:** Locked session gets 423/403 on any non-allowlisted route

### 2.3 Lock/unlock endpoints, unlock reauth, own rate limiter
- [x] Status (done 2026-10-19; HTTP-tested in 2.8)
- **Read:** references/spec-digest.md §6.2
- **Open:** `backend/src/routes/qr.js`
- **Done when:** Unlock needs correct password; failures throttled

### 2.4 QR token generation (random, single-use, 45 s)
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §7 step 1
- **Open:** `backend/src/services/qrToken.js`
- **Done when:** Token row stored hashed; expires in ~45 s


## Day 6: Tablet UI

### 2.5 QR page: clock, QR render, countdown, Generate buttons
- [x] Status (done 2026-10-19; not rendered, see status notes)
- **Read:** references/spec-digest.md §6
- **Open:** `frontend/src/pages/QrAttendance.jsx`
- **Done when:** New QR appears and countdown runs

### 2.6 Locked display mode, state restored from server
- [x] Status (done 2026-10-19; not rendered)
- **Read:** references/spec-digest.md §6.1
- **Open:** `frontend/src/pages/QrAttendance.jsx, frontend/src/components/HrLayout.jsx`
- **Done when:** Refresh stays locked; sidebar hidden

### 2.7 Unlock dialog
- [x] Status (done 2026-10-19; not rendered)
- **Read:** references/spec-digest.md §6.2
- **Open:** `frontend/src/components/UnlockDialog.jsx`
- **Done when:** Correct password restores sidebar

### 2.8 Lock tests
- [x] Status (written 2026-10-19; NOT yet run: needs `npm ci` + Postgres. Treat "Tests 2,3,4,5,6 pass" as open until then)
- **Read:** references/spec-digest.md §26 #2-6
- **Open:** `backend/tests/lock.test.js`
- **Done when:** Tests 2,3,4,5,6 pass


## Day 7: Selfie capture and storage

### 2.9 Cloudinary service: private upload, signed expiring URL, delete
- [x] Status (done 2026-10-19; logic unit-tested with a fake SDK, real-account check pending via scripts/cloudinary-smoke.js)
- **Read:** references/spec-digest.md §22, §7
- **Open:** `backend/src/services/cloudinary.js`
- **Done when:** Uploaded image URL without signature fails

### 2.10 Keep token across login via router state
- [x] Status (done 2026-10-19; not rendered)
- **Read:** references/spec-digest.md §7 step 2
- **Open:** `frontend/src/pages/Login.jsx, frontend/src/pages/portal/Scan.jsx`
- **Done when:** Token survives login, never sent to other sites

### 2.11 Scan page: front camera, preview, capture, retake, compress ~150 KB
- [x] Status (done 2026-10-19; not rendered)
- **Read:** references/spec-digest.md §7 step 3
- **Open:** `frontend/src/pages/portal/Scan.jsx, frontend/src/api/image.js`
- **Done when:** No gallery option; output ~100-200 KB

### 2.12 Submit endpoint skeleton: auth, token validation, active check
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §7 step 4
- **Open:** `backend/src/routes/attendance.js`
- **Done when:** Invalid/expired token rejected


## Day 8: Attendance transaction

### 2.13 Next-action logic and duplicate guard
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §8
- **Open:** `backend/src/services/attendance.js`
- **Done when:** Second check-in same day rejected

### 2.14 Transaction: consume token + insert attendance + row lock
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §7 step 4
- **Open:** `backend/src/services/attendance.js`
- **Done when:** Token consumed only on commit

### 2.15 Upload-before-commit with orphan photo cleanup
- [x] Status (done 2026-10-19)
- **Read:** references/spec-digest.md §7 step 4
- **Open:** `backend/src/services/attendance.js`
- **Done when:** Failed DB write deletes uploaded photo

### 2.16 Status and late-minutes (company timezone, same-day shifts)
- [x] Status (done 2026-10-28; pure + real-Postgres tests pass)
- **Read:** references/spec-digest.md §8
- **Open:** `backend/src/services/attendanceStatus.js`
- **Done when:** Late/Present computed with grace period


## Day 9: HR views and tests

### 2.17 HR attendance list API (filters, pagination) and signed selfie URL
- [x] Status (done 2026-10-28; 9 real-Postgres tests pass; note the route lives in `routes/attendanceRecords.js`, not attendance.js)
- **Read:** references/spec-digest.md §8, §22
- **Open:** `backend/src/routes/attendance.js`
- **Done when:** Filters by date/employee; URL expires

### 2.18 HR attendance page, selfie viewer, correction dialog + API
- [x] Status (done 2026-10-28; API tested on real Postgres; page compiles + helpers unit-tested, NOT rendered in a browser)
- **Read:** references/spec-digest.md §8
- **Open:** `frontend/src/pages/Attendance.jsx`
- **Done when:** Correction requires reason and writes audit row

### 2.19 Employee attendance history and success confirmation
- [x] Status
- **Read:** references/spec-digest.md §7 step 5
- **Open:** `frontend/src/pages/portal/History.jsx, Scan.jsx`
- **Done when:** Confirmation shows name, date, time, in/out, status

### 2.20 Tests: expiry, replay, concurrency, check-out before check-in, private selfies
- [x] Status
- **Read:** references/spec-digest.md §26 #7-11
- **Open:** `backend/tests/attendance.test.js`
- **Done when:** Tests 7-11 pass
