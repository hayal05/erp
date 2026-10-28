# LOC Budget (custom code only; no deps/lockfiles/generated/docs)

Target 7,000 · Hard ceiling 9,000 · Report with `cloc` after each phase; explain if a phase is >10% over.

| Phase | Backend | Frontend | SQL | Tests | Total |
|---|---|---|---|---|---|
| 1 Foundation | 350 | 450 | 120 | 130 | ~1,050 |
| 2 QR attendance | 600 | 650 | 60 | 350 | ~1,660 |
| 3 Leave | 280 | 300 | 50 | 120 | ~750 |
| 4 Payroll | 700 | 800 | 110 | 400 | ~2,010 |
| 5 Test sweep/deploy | 60 | 0 | 0 | 150 | ~210 |
| Config | | | | | ~80 |
| **Total** | ~1,990 | ~2,200 | ~340 | ~1,150 | **~5,760** |

Scenarios: planned 5,760 · likely 6,500 · worst 6,900 · headroom used 7,500–8,200 · ceiling 9,000.
Extra headroom priority: (1) security/correctness tests, (2) payroll edge cases, (3) failure handling, (4) responsive CSS. No charts/animations/extra filters beyond spec.
Dashboard charts (hand-written SVG) add ~150 LOC; light/dark theming ~60–100 CSS lines.
