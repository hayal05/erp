# Natra ERP — Spec Digest (section numbers match the original prompt)

**§1 Objective** HRM + payroll web app, ~50 employees. Modules: Employees, QR selfie attendance, Leave, Payroll, Dashboard/reports, Employee self-service. Two roles only: HR Administrator, Employee. Office tablet = normal HR login, not a role. Target 5,000–7,000 LOC (ceiling agreed: 9,000, justify anything over 7,000).

**§2 Stack** React+Vite (JS, plain CSS, React Router, Lucide) · Node+Express REST · server-side sessions, HTTP-only cookies · Neon Postgres via `pg`, parameterized SQL, SQL migrations · Cloudinary private selfies, browser-side compression · Render Free (static + web), UptimeRobot · ~512 MB RAM · no Redis/ORM/microservices.

**§3 Roles** HR: manage employees, departments, schedules, salaries, attendance, selfie review, corrections (with reasons), leave, tax/pension/deduction config, payroll generate/approve/pay, payslips/reports, QR page lock/unlock, settings. Employee: login, profile, scan QR + selfie, attendance history, leave requests/balances, own approved payslips. Employees never see others' data.

**§4 HR interface** Left sidebar: Dashboard, Employees, **Departments**, Attendance, QR Attendance, Leave, Payroll, Settings. Responsive. *(Departments added by the owner's Phase 6 request, 2026-10-29; the original spec listed seven items.)*

**§5 Tablet architecture** No kiosk app/role/account. HR logs in on tablet → QR Attendance → Lock QR Screen. Lock is per authenticated session; other devices unaffected.

**§6 QR page** Company name/logo, date/time, Generate New QR, large QR, expiry countdown, Generate Again, Lock button.
- **6.1 Lock:** locked mode hides sidebar/admin controls; Generate stays active; small Unlock control; survives refresh; no bypass via URL/back/other tab. Enforced **server-side** with a session lock field. Locked allowlist: display QR page, generate tokens, minimal session state, unlock, logout. Everything else requires unlocked session.
- **6.2 Unlock:** reauth dialog, password verified on backend, rate-limited, unlocks current session only, no password in storage.
- **6.3 Sessions:** server-side, lock state server-side, session-specific, secure expiry, safe logout.

**§7 Attendance workflow**
1. Token: crypto-random, single-use, ~45 s, tied to authorized HR session, server-validated.
2. Employee scans with own phone; logs in if needed; token preserved without leaking externally.
3. Front camera via getUserMedia; preview/capture/retake/submit; no gallery upload; compress to ~100–200 KB.
4. Submit: authenticate, validate token + expiry + reuse + issuing session was authorized, employee active, determine check-in/out, block duplicates, upload to Cloudinary, server timestamp, consume token **inside** the DB transaction, return success. Upload fail → no attendance. DB fail after upload → delete photo.
5. Confirmation: name, date, time, in/out, status. HR sees record on refresh (no websockets).

**§8 Attendance rules** Check-in + check-out via same QR flow. Record: employee, work date, in/out timestamps, in/out selfie refs, status, late minutes, correction info. Statuses: Present, Late, Absent, On Approved Leave, Incomplete. HR config: working days, shift start/end, grace period, holidays, late rules. **MVP: same-day shifts only (documented).** Company timezone, server timestamps. Absences from schedule/holidays/leave. HR page: employee, dept, date, in, out, status, selfie review, correction; date + employee filters. Corrections need reason + audit. No facial recognition/liveness.

**§9 Employees** ID, name, email, phone, department, title, start date, type, status, schedule, basic salary, login. Add/edit/search/filter/activate/deactivate, assign schedule, set salary, view attendance+leave history. No hard delete with history.

**§10 Leave** Types: annual, sick, personal, unpaid. Request: type, dates, reason; days auto-calculated (working days, holidays). Balances + statuses visible. HR: approve/reject/remarks, adjust balances with reason, entitlements. No overlapping approved leave, no invalid balances. Approved leave drives attendance classification; unpaid leave may affect payroll per settings.

**§11 Payroll sheet** Columns exactly, in order: Employee ID | Employee Name | Basic Salary | Allowance | Income Tax | Other Tax | Pension | Other Deductions | Net Salary. Compact Excel-style, right-aligned numbers, horizontal scroll. Basic + Allowance editable; rest computed. All settings adjustable, formulas fixed in backend, no formula editor.

**§12 Payroll settings** Sections: Income Tax, Pension, Other Taxes, Other Deductions. Validated, stored in Postgres, apply to new/draft payroll only.

**§13 Income tax** Brackets: From | To | Rate % | Fixed Deduction (add/remove/edit). **Tax = MAX(0, TaxableIncome × Rate/100 − FixedDeduction)** (quick-deduction, not marginal). Example: 2,500 @15%, ded 150 → 225. Validate gaps/overlaps/no-match; block calc/approval if invalid. Taxable base setting: basic only, or basic + taxable allowances. Example values illustrative only.

**§14 Pension** Employee rate (default 5%), company rate (default 10%), both editable. Employee = Pensionable × rate/100; Company likewise. **Only employee pension reduces net.** Company pension tracked as employer cost. Pensionable base: basic, or basic + selected allowances. Per-employee applicability.

**§15 Other taxes** Name, %, calculation base (predefined only), enabled. Tax = Base × Rate/100; summed into Other Tax column.

**§16 Other deductions** Flat amounts (advance, loan, penalty, other): name, amount, employee applicability, recurring/one-time, enabled. Sum into one column; breakdown in row detail/payslip.

**§17 Engine** One backend module. Gross = Basic + Allowances. Net = Gross − IncomeTax − OtherTaxes − EmployeePension − OtherDeductions. Employer cost = Gross + Employer Pension. Integer minor units/exact decimals, configurable rounding. Backend authoritative. Unpaid-leave/absence deductions applied exactly once if enabled. No assumed statutory rules.

**§18 Workflow** Draft (editable, auto-recalc) → Approved (locked, immutable snapshot of salary, allowances, bracket/rate, tax, pension config + amounts, other taxes, deductions, net) → Paid (date saved, no gateway). Employees view/print released payslips. CSV export. All transitions audited.

**§19 Dashboard** Total employees, present/late/absent today, on leave, pending leave, monthly payroll total; recent attendance + pending leave; light charts optional.

**§20 Frontend** Clean HR style, compact tables, responsive, simple dialogs. Employee portal mobile-first. Locked QR page touch-friendly. No native app.

**§21 Database** Tables: users, sessions, employees, departments, shifts, attendance_tokens, attendance_records, leave_types, leave_balances, leave_requests, salary_profiles, payroll_settings, income_tax_brackets, deduction_items, payroll_periods, payroll_entries, payroll_entry_items, audit_logs (may consolidate). FKs, uniques, attendance indexes, transactional token use, audit, payroll snapshots, session isolation.

**§22 Security** Strong password hashing, HTTP-only cookies, CSRF, SameSite, HTTPS, server-side role + lock checks, unlock reauth, login/unlock rate limits, parameterized SQL, validation, QR replay protection, private Cloudinary with time-limited URLs, protected salary data, payroll audit, env secrets, no secrets/tokens in logs. Retention + deletion procedure for photos.

**§23 Performance** ~512 MB, light responses, pooled DB (few connections), paginated lists, no polling, no heavy jobs. `GET /health`. No reliance on ephemeral disk. Backup guidance + manual attendance fallback.

**§24 Structure** Monorepo: frontend/, backend/, database/migrations/, .env.example, render.yaml, README.md.

**§26 Required tests (17)**
1 Employee can't reach HR pages/others' salary · 2 Locked session blocked from admin endpoints · 3 URL change doesn't bypass lock · 4 Refresh keeps lock · 5 Unlock needs valid reauth · 6 Unlock on one device doesn't affect another · 7 Tokens expire · 8 Consumed tokens can't be reused · 9 Concurrent requests don't duplicate attendance · 10 No check-out before check-in · 11 Selfies not public · 12 Bracket picks correct rate/deduction · 13 Employee vs company pension distinct · 14 Flat deductions summed · 15 Net salary correct · 16 Approved payroll can't be recalculated · 17 History unchanged after config change.

**§28 Deliverables** Everything above + Neon, Cloudinary, Render config, health endpoint, tests, README/setup, actual LOC report.
