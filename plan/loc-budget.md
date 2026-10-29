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

## Phase 6 addition (2026-10-29): Departments, Positions, default salary (planned, built; actuals below)
| Part | Backend | Frontend | SQL | Tests | Total |
|---|---|---|---|---|---|
| 6 Departments and positions | ~190 | ~250 | ~35 | ~225 | ~700 |

The project is already over the 9,000 ceiling when tests are counted (`loc-report.md`: 14,343 total, 7,196 production). This phase adds roughly 475 production lines (about 7% of current production code) and ~225 test lines. Payroll code is not touched (one allowance only). Recount with `plan/references/count-loc.py` when built and report the real number; do not restate the budget to hide it.

### Phase 6 actuals (recount 2026-10-29, after task 6.11; `plan/references/count-loc.py`, not cloc)
| Area | At task 5.8 | Now | Change | Phase 6 estimate |
|---|---|---|---|---|
| Backend source | 2,981 | 3,206 | +225 | ~190 |
| Frontend source + CSS | 3,656 | 4,231 | +575 | ~250 |
| SQL migrations | 375 | 397 | +22 | ~35 |
| Config | 184 | 144 | -40 | |
| **Production subtotal** | **7,196** | **7,978** | **+782** | **~475** |
| Backend tests | 6,171 | 6,922 | +751 | |
| Frontend tests | 976 | 1,245 | +269 | |
| **Tests subtotal** | **7,147** | **8,167** | **+1,020** | **~225** |
| **Total** | **14,343** | **16,145** | **+1,802** | **~700** |

Phase 6 came in at about 2.6x its estimate (production 1.6x, tests 4.5x). Caveats: the 5.8 baseline predates Phase 6 by a few sessions, so the change column includes any small edits made in between (the single-service merge shrank the config by 40 lines); and this is the count of code written, with the 6.4 to 6.11 code not yet run. The whole project is still over the 9,000 ceiling when tests are counted (16,145) and production code alone (7,978) is 14% over the 7,000 target and 11% under the ceiling. Nothing was trimmed or restated to hide this; the owner decision in `loc-report.md` is still open.
