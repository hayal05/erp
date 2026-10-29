# Phase 3: Leave  (est. ~750 LOC)

Format: **Read** = reference to open first · **Open** = files to create/edit · **Done when** = acceptance check.


## Day 10: Backend

### 3.1 Migration 003: leave_types, leave_balances, leave_requests, holidays
- [x] Status
- **Read:** references/spec-digest.md §21, §10
- **Open:** `database/migrations/003_leave.sql`
- **Done when:** Migration runs clean

### 3.2 Working-day calculator (schedule + holidays)
- [x] Status
- **Read:** references/spec-digest.md §10, §8
- **Open:** `backend/src/services/workdays.js`
- **Done when:** Weekends/holidays excluded per schedule

### 3.3 Leave request API (auto days, overlap + balance checks)
- [x] Status
- **Read:** references/spec-digest.md §10
- **Open:** `backend/src/routes/leave.js` (employee side; the HR half goes in `routes/leaveAdmin.js`, see status notes)
- **Done when:** Overlap and over-balance requests rejected

### 3.4 HR approve/reject/remarks/balance-adjust (reasons, audited)
- [x] Status
- **Read:** references/spec-digest.md §10
- **Open:** `backend/src/routes/leaveAdmin.js` (mounted at `/api/leave-admin`)
- **Done when:** Adjustment without reason rejected


## Day 11: Frontend

### 3.5 Employee leave page
- [x] Status
- **Read:** references/spec-digest.md §10, §20
- **Open:** `frontend/src/pages/portal/Leave.jsx`
- **Done when:** Balances, form and statuses shown

### 3.6 HR leave page (queue, decisions, entitlements)
- [x] Status
- **Read:** references/spec-digest.md §10
- **Open:** `frontend/src/pages/Leave.jsx`
- **Done when:** Approve/reject updates balances

### 3.7 Holidays and working-day settings
- [x] Status
- **Read:** references/spec-digest.md §8
- **Open:** `frontend/src/pages/Settings.jsx, backend/src/routes/settings.js`
- **Done when:** Holiday changes affect day counts


## Day 12: Integration

### 3.8 Approved leave feeds attendance status and absence calc
- [x] Status
- **Read:** references/spec-digest.md §8, §10
- **Open:** `backend/src/services/attendanceStatus.js`
- **Done when:** 'On Approved Leave' shows in attendance/dashboard

### 3.9 Leave tests
- [x] Status
- **Read:** references/spec-digest.md §26
- **Open:** `backend/tests/leave.test.js`
- **Done when:** Balances, overlaps, leave-aware absence pass
