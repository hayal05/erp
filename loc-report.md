# Natra ERP: actual LOC report (task 5.8, 2026-10-28)

## Verdict

| Measure | Lines of code | Against target 7,000 | Against ceiling 9,000 |
|---|---|---|---|
| **Everything counted by `plan/loc-budget.md`'s own definition** (custom code including tests, SQL, config) | **14,343** | +7,343 (2.0x) | **+5,343 (59% over): ceiling exceeded** |
| Production code only (source, CSS, SQL, config; tests excluded) | 7,196 | +196 (3% over) | 1,804 under |
| Tests only | 7,147 | n/a | n/a |

**The "within the 9,000 ceiling" check from the task is not met** under the definition the budget file uses (its table has a Tests column, so tests are inside the 9,000). It is met only if tests are excluded, which is a different rule from the one set on 2026-10-19. This report does not move the goalposts: the ceiling is exceeded and the owner has to decide what that means (see "Decision needed").

## How this was counted (and what it is not)

`cloc` could not be installed: the build environment has no network. The numbers come from `plan/references/count-loc.py`, a small script that applies cloc's definitions (blank lines, comment-only lines, everything else is code; a line with code and a trailing comment counts as code). Scope: every `.js .mjs .jsx .css .sql .json .yaml .html` file outside `node_modules`, `dist` and `plan/`, excluding `package-lock.json` and `.env*`. README and other prose are not counted.

It is **not cloc output**, so small differences (a few tenths of a percent, mostly in how block comments and JSX comments are classified) are possible. To get the official figure on any machine with cloc:

```bash
cloc --exclude-dir=node_modules,dist,plan --not-match-f='package-lock\.json' .
```

Cross-check: the last real `cloc` figure in the status log (after task 3.3) was 7,678 lines; the growth to 14,343 since then covers the rest of phase 3 and all of phase 4 and 5 and is plausible for the work logged.

## Results

By language:

| Language | Files | Blank | Comment | Code |
|---|---|---|---|---|
| JavaScript | 161 | 1,189 | 688 | 10,922 |
| JSX | 39 | 217 | 90 | 2,587 |
| SQL | 4 | 27 | 85 | 375 |
| CSS | 1 | 30 | 23 | 284 |
| YAML | 1 | 1 | 2 | 82 |
| JSON | 3 | 0 | 0 | 74 |
| HTML | 1 | 0 | 0 | 19 |
| **Total** | **210** | **1,464** | **888** | **14,343** |

By area, against the original budget (`plan/loc-budget.md`):

| Area | Files | Code | Budgeted | Actual / budget |
|---|---|---|---|---|
| Backend source (routes, services, middleware, db, scripts) | 60 | 2,981 | ~1,990 | 1.5x |
| Frontend source (React) + CSS | 62 + 1 | 3,372 + 284 = 3,656 | ~2,200 | 1.7x |
| SQL migrations | 4 | 375 | ~340 | 1.1x |
| Config (package.json, vite, render.yaml, index.html) | 6 | 184 | ~80 | 2.3x |
| **Production subtotal** | **133** | **7,196** | **~4,610** | **1.6x** |
| Backend tests | 58 | 6,171 | ~1,150 (all tests) | |
| Frontend tests | 19 | 976 | | |
| **Tests subtotal** | **77** | **7,147** | **~1,150** | **6.2x** |
| **Total** | **210** | **14,343** | **~5,760** | **2.5x** |

Largest single files: `backend/tests/payroll.test.js` 461, `backend/tests/schema.test.js` 294, `frontend/src/styles.css` 284, `backend/tests/attendanceRecords.test.js` 272, `backend/tests/deductions.test.js` 248, `database/migrations/004_payroll.sql` 170, `frontend/src/pages/portal/Scan.jsx` 166. No production file is unusually large; the biggest are tests.

Line density is ordinary (average 58 to 69 characters per code line), but about 1,500 code lines are longer than 120 characters. Reformatting to a conventional 80 to 100 column style would raise every figure above somewhat; the counts are not inflated by dense formatting, if anything the opposite.

## Why it is over (from the evidence in the project log)

- **Tests are half the code and were budgeted at a fifth.** The 7,147 test lines back 517 backend and 121 frontend tests, including the database suites, the 17 required checks, and the multi-connection concurrency cases. The budget's own "extra headroom" priority list put security/correctness tests first, so this is the deliberate overrun, but it is far larger than the 1,150 lines planned. The status log flagged the pattern at the end of phase 1 (about 4,500 lines against about 1,050 estimated, roughly 45% tests) and the ceiling warning at task 3.3 (7,678 lines).
- **Production code is 1.6x the estimate**, mainly frontend pages (many dialogs, loading/error/retry states, mobile layout) and the payroll backend (engine, snapshot, immutability, attendance deductions, stale-approval checks, CSV, payslips).
- **No per-phase actuals can be reported.** The project is not under version control here and earlier sessions recorded totals rather than per-phase counts, so the budget rule "explain if a phase is more than 10% over" can only be answered for the whole project: every area except SQL is more than 10% over.

## Trade-offs

What the size bought: server-side enforcement of roles, screen lock, replay protection and payroll immutability, each with tests that run against a real PostgreSQL server; exact integer money handling; honest failure behaviour (no half-recorded scans, orphan photo cleanup, stale-draft refusal); a responsive UI with light/dark themes and loading/error/empty states on every list.

What it costs: more to read, more to maintain, a larger review surface for a "about 50 people" company. Nothing in the spec was skipped to save lines, and nothing outside the spec was added on purpose (no charts, animations or extra filters).

## Decision needed from the owner

1. **Accept the overrun and restate the budget** as target 7,000 and ceiling 9,000 for *production code* (currently 7,196, passes) with tests tracked separately (7,147). This matches how the code is actually organised and keeps the guard meaningful for the product itself. Recommended.
2. **Keep the original definition** and treat 14,343 against 9,000 as a failed budget. Getting under 9,000 would mean removing about 5,300 lines, which at this ratio is most of the test suite or a large part of the product; that conflicts with the required-tests and security goals and is not recommended without a spec change.
3. **Trim selectively**, for example overlapping test files or optional page states. The saving would be a few hundred lines, not thousands, and this report does not identify safe candidates; that needs a deliberate review.

Whichever is chosen, rerun the count script (or real cloc) after any change and update this file.


## Update after Phase 6 (2026-10-29, task 6.13)

Recounted with `plan/references/count-loc.py` (same definitions as above; still not cloc): **16,145 code lines in 229 files** (JS 12,303, JSX 3,020, SQL 397, CSS 290, JSON 74, YAML 42, HTML 19). Production code **7,978** (backend 3,206, frontend 3,941 + CSS 290, SQL 397, config 144); tests **8,167** (backend 6,922, frontend 1,245). Against the 5.8 figures that is +782 production and +1,020 tests (+1,802 total); the per-area table and caveats are in `plan/loc-budget.md`. **Verdict unchanged:** the 9,000 ceiling is exceeded when tests count (16,145), and the decision requested in section "Decision needed from the owner" is still open. Production code alone is 978 under the ceiling. Run real cloc (command above) to confirm the official figure.
