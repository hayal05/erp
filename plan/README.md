# Natra ERP — Project Plan Pack

Lives at `natra-erp/plan/`. Code is in the sibling folders `backend/`, `frontend/`, `database/`.

Everything needed to build the MVP, in one folder.

## Open in this order
0. `project status.md` — current progress, decisions and open questions. Updated every session.
1. `references/spec-digest.md` — requirements by section number (§). Tasks cite these.
2. `references/ui-notes.md` — layout reference.
3. `schedule.md` — 21-day plan with checkboxes.
4. `tasks/phase-1…5-*.md` — every small task, with the spec sections to read, the files to open/create, and a "done when" check.
5. `loc-budget.md` — LOC estimates (target 7,000, ceiling 9,000).

## How to use a task
Each task lists **Read** (spec § / reference), **Open** (files to create or edit), and **Done when**.
Open the Read items first, then the Open files, build, verify the Done-when line, tick the box in `schedule.md`.

## Known gaps
- The salary-sheet screenshot has not been supplied. The payroll table follows the 9-column list in spec §11 until it is.
- The original spec was not available as a file, so `spec-digest.md` is a section-by-section digest, not a verbatim copy. Add the original as `references/spec-original.md` if you want it in the folder.

## Planned repo layout (for the "Open" paths)
```
natra-erp/
├── frontend/src/{components,pages,api}/ App.jsx main.jsx
├── backend/src/{routes,services,middleware,db}/ server.js
├── backend/tests/
├── database/migrations/
├── .env.example  render.yaml  README.md
```

## Required-test traceability

See `references/required-tests.md` for all 17 requirement-to-case mappings, runnable local commands and explicitly pending native/provider/device checks.
