# UI Reference Notes

Source: "Dot Bikes" dark glass dashboard, used as layout reference for the HR Admin shell.

## Take
- Top bar: logo left; date/time + user chip (name, role) right.
- Left sidebar: icon + label rows, accent bar on active item.
- Dashboard: 3 summary cards → period bar (Last week / Last month / Last year chips) → 3 chart cards → "Latest" table → "All …" button.
- Rounded translucent cards, soft borders, small muted label over large number, green/red growth indicators.
- Priority colours (red/orange/green) reused for statuses.

## Map to Natra ERP
- Sidebar: Dashboard, Employees, Attendance, QR Attendance, Leave, Payroll, Settings, Log out.
- Summary cards: Total employees · Monthly payroll total · Present today (Late/Absent as small side figures).
- Area chart: attendance trend. Donut: today's Present/Late/Absent/On leave. Bars: check-ins by weekday. (Hand-written SVG, no chart lib.)
- Table: recent attendance + pending leave, status colours (Late, Pending, Incomplete).

## Decisions
- Spec §20 asks for light background; reference is dark → build both via CSS variables. **Decided: dark default with a light toggle.**
- Employee portal stays mobile-first; locked QR page stays large and simple.
- Salary sheet: this is NOT the payroll reference. Use 9-column Excel-style table (spec §11) until screenshot supplied.
