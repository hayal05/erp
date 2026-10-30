# Compact UI redesign review

Reviewed: 2026-10-30.

All 15 implementation steps have been prepared as separate dependent pull requests. This final review adds small consistency fixes and an offline render check. The changes have not been deployed, and browser-based sign-off remains pending.

| Step | Scope | PR |
|---|---|---|
| 1 | Shared spacing, controls, cards, tables, tabs, dialogs | #39 |
| 2 | Management and employee layouts | #40 |
| 3 | Dashboard and workspace home | #41 |
| 4 | Employees and salary profiles | #42 |
| 5 | Departments and positions | #43 |
| 6 | Attendance, Archive, corrections, QR and unlock | #44 |
| 7 | Leave queues and decision/balance dialogs | #45 |
| 8 | Payroll, salary details and company costs | #46 |
| 9 | Payroll settings and deduction editors | #47 |
| 10 | Settlements and payment details | #48 |
| 11 | Approvals and proposal reviews | #49 |
| 12 | Access Management and role history | #50 |
| 13 | Announcements, vacancies and applicant reviews | #51 |
| 14 | Employee home, profile, history, leave, scan and payslips | #52 |
| 15 | Login, password changes, holidays and schedules | #53 |
| 16 | Consistency fixes and automated review | This change |

## Verified locally

- All 182 existing frontend tests passed.
- 156 offline render cases passed, covering initial page states across Admin, HR, Finance and employee identities, plus representative loaded views and dialogs.
- Render assertions preserve saved net salary/employer totals, applicant snapshot content, role-controlled posting/grant actions, and label/error references. Shared headers also render under both theme settings.
- Frontend production build passed.
- Backend syntax build passed for all 83 source files.
- All 12 backend permission tests passed.
- Source review retained contained table scrolling, independent management panes, permission filtering, keyboard labels, essential financial confirmations and visible payslip content.

Run the offline render check with:

```sh
npm --prefix frontend run check:ui
```

The render check uses local fixtures, substitutes resource/auth hooks, and inlines modal portals for React's server renderer. It does not run effects, issue mutations, simulate a live server, calculate browser geometry or prove keyboard/camera/print behavior. It adds no runtime dependency.

## Final review fixes

- Long dialog headings wrap without pushing the Close control outside the dialog.
- Fixed audit-footer offsets include device safe areas; its existing two-row facts remain unchanged.
- Compact audit controls and salary actions retain touch-sized targets on touch devices.
- Login field errors have explicit accessible description references.
- Dashboard loading placeholders follow the new summary-card layout.

## Browser checks still pending

Chromium was unavailable locally. Its attempted download failed because the downloaded archive was invalid. These checks must be completed before visual sign-off:

- Inspect widths 320, 390, 768, 1024, 1366 and 1920 pixels, including long names, titles, notes and amounts.
- Inspect light and dark themes; confirm pages fit, tables scroll within their containers, sidebar/main scrolling stays independent and the audit footer does not cover content.
- Exercise keyboard navigation, visible focus, dropdowns, expandable details, modal focus/return, applicant list/profile transitions and hidden settings sections.
- Inspect initial loading, background refresh, empty, error/retry, pending-approval and read-only states with a real API session.
- Scan the QR and exercise selfie capture, retake, submission, expiry and unlock on a phone.
- Print a populated payslip and inspect every financial line, table, page break and navigation exclusion.

## Merge order

Merge #39 first. Retarget #40 to `main`, verify its expected head and merge it; repeat in order through the remaining steps. Do not merge a later step into an earlier feature branch. Each PR initially targets the preceding branch to keep its individual review diff small.
