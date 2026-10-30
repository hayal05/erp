import {usePageRefresh} from '../api/pageRefresh.jsx';
import {usePermission} from '../api/auth.jsx';
import { useCallback, useEffect, useState } from 'react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Table, { Badge, Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { get } from '../api/client.js';
import { DecisionDialog, EntitlementDialog } from './LeaveDialogs.jsx';
import { NO_FILTERS, STATUS_FILTER, queueRow } from './leaveAdminView.js';

const PAGE_SIZE = 20;
const empOption = (e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` });

// HR leave (spec 10): the approval queue (pending first) and each employee's yearly entitlements.
// Decisions and balance changes are always confirmed in a dialog; the server counts days and refuses overlaps and overspending.
export default function Leave() {
  const pageRefresh = usePageRefresh();
  const toast = useToast();
  const [tab, setTab] = useState('requests');
  const [lookups, setLookups] = useState({ departments: [], employees: [] });

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([get('/departments', { pageSize: 100 }, { signal: ctrl.signal }), get('/employees', { pageSize: 100 }, { signal: ctrl.signal })])
      .then(([d, e]) => setLookups({ departments: d.items, employees: e.items }))
      .catch((e) => { if (e.name !== 'AbortError') toast.error(`Could not load the filter lists: ${e.message}`); });
    return () => ctrl.abort();
  }, [toast, pageRefresh]);

  return (
    <section className="stack">
      <div className="row between">
        <h1>Leave</h1>
        <div className="row" role="group" aria-label="Leave sections">
          <Button variant={tab === 'requests' ? 'primary' : 'default'} aria-pressed={tab === 'requests'} onClick={() => setTab('requests')}>Requests</Button>
          <Button variant={tab === 'entitlements' ? 'primary' : 'default'} aria-pressed={tab === 'entitlements'} onClick={() => setTab('entitlements')}>Entitlements</Button>
        </div>
      </div>
      {tab === 'requests' ? <Requests lookups={lookups} /> : <Entitlements employees={lookups.employees} />}
    </section>
  );
}

function Requests({ lookups }) {
  const pageRefresh = usePageRefresh();
  const canManage=usePermission('leave.manage');
  const toast = useToast();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [state, setState] = useState({ loading: true, error: '' });
  const [deciding, setDeciding] = useState(null); // null | { request, decision }
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/leave-admin/requests', { page, pageSize: PAGE_SIZE, ...filters }, { signal: ctrl.signal })
      .then((r) => { setData(r); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') { setState({ loading: false, error: e.message }); toast.error(`Could not load requests: ${e.message}`); } });
    return () => ctrl.abort();
  }, [page, filters, reload, toast, pageRefresh]);

  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const thisYear = new Date().getFullYear(); // display only: the list of years offered
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => <><strong>{r.employee}</strong><br /><small className="muted">{r.code}</small></> },
    { key: 'type', header: 'Type' },
    { key: 'dates', header: 'Dates', className: 'nowrap' },
    { key: 'days', header: 'Days', align: 'num' },
    { key: 'reason', header: 'Reason', render: (r) => r.reason || '—' },
    { key: 'status', header: 'Status', render: (r) => (
      <>
        <Badge tone={r.tone}>{r.status}</Badge>
        {r.remarks && <><br /><small className="muted">HR: {r.remarks}</small></>}
      </>
    ) },
    { key: 'act', header: <span className="sr-only">Decide</span>, className: 'nowrap', render: (r) => canManage && r.canDecide && (
      <span className="row">
        <Button size="sm" variant="primary" onClick={() => setDeciding({ request: r, decision: 'approve' })} aria-label={`Approve leave of ${r.employee}, ${r.dates}`}>Approve</Button>
        <Button size="sm" onClick={() => setDeciding({ request: r, decision: 'reject' })} aria-label={`Reject leave of ${r.employee}, ${r.dates}`}>Reject</Button>
      </span>
    ) },
  ];

  return (
    <>
      <div className="toolbar toolbar-4">
        <Field as="select" label="Status" placeholder="All statuses" value={filters.status} onChange={setFilter('status')} options={STATUS_FILTER} />
        <Field as="select" label="Employee" placeholder="All employees" value={filters.employeeId} onChange={setFilter('employeeId')} options={lookups.employees.map(empOption)} />
        <Field as="select" label="Department" placeholder="All departments" value={filters.departmentId} onChange={setFilter('departmentId')}
          options={lookups.departments.map((d) => ({ value: d.id, label: d.name }))} />
        <Field as="select" label="Year" placeholder="All years" value={filters.year} onChange={setFilter('year')}
          options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: y, label: String(y) }))} />
      </div>
      {filtered && <div className="row"><Button onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Reset filters</Button></div>}

      <Table caption="Leave requests" columns={columns.filter(c=>canManage||c.key!=='act')} rows={data.items.map(queueRow)} loading={state.loading} error={state.error} onRetry={refresh}
        empty={filters.status === 'pending' && !filtered ? 'No requests are waiting for a decision' : 'No leave requests match these filters'} />
      <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} disabled={state.loading} />

      {canManage && deciding && <DecisionDialog key={`${deciding.request.id}-${deciding.decision}`} {...deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); refresh(); }} />}
    </>
  );
}

function Entitlements({ employees }) {
  const pageRefresh = usePageRefresh();
  const canManage=usePermission('leave.manage');
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [year, setYear] = useState(null); // null = the server's current company year
  const [data, setData] = useState({ year: null, items: [] });
  const [state, setState] = useState({ loading: false, error: '' });
  const [editing, setEditing] = useState(null); // null | a balance row
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const employee = employees.find((e) => String(e.id) === String(employeeId));

  useEffect(() => {
    if (!employeeId) { setData({ year: null, items: [] }); return undefined; }
    const ctrl = new AbortController();
    setState({ loading: true, error: '' });
    get('/leave-admin/balances', { employeeId, year }, { signal: ctrl.signal })
      .then((r) => { setData(r); if (year === null) setYear(r.year); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') { setState({ loading: false, error: e.message }); toast.error(`Could not load balances: ${e.message}`); } });
    return () => ctrl.abort();
  }, [employeeId, year, reload, toast, pageRefresh]);

  const years = data.year ? [data.year - 1, data.year, data.year + 1].map((y) => ({ value: y, label: String(y) })) : [];
  const columns = [
    { key: 'name', header: 'Leave type', render: (b) => <strong>{b.name}</strong> },
    { key: 'entitled', header: 'Entitlement', align: 'num', render: (b) => (b.hasBalance ? b.entitled : '—') },
    { key: 'adjusted', header: 'HR adjustment', align: 'num', render: (b) => (b.hasBalance ? `${b.adjusted > 0 ? '+' : ''}${b.adjusted}` : '—') },
    { key: 'used', header: 'Used', align: 'num' },
    { key: 'pending', header: 'Pending', align: 'num' },
    { key: 'remaining', header: 'Left', align: 'num', render: (b) => (b.hasBalance ? b.remaining : 'No limit') },
    { key: 'act', header: <span className="sr-only">Change</span>, render: (b) => canManage && b.hasBalance && (
      <Button size="sm" onClick={() => setEditing(b)} aria-label={`Change ${b.name.toLowerCase()} balance of ${employee?.fullName}`}>Change</Button>
    ) },
  ];

  return (
    <>
      <div className="toolbar toolbar-2">
        <Field as="select" label="Employee" placeholder="Choose an employee…" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setYear(null); }} options={employees.map(empOption)} />
        {years.length > 0 && <Field as="select" label="Year" value={year ?? data.year} onChange={(e) => setYear(Number(e.target.value))} options={years} />}
      </div>
      {!employeeId ? <p className="muted">Choose an employee.</p> : (
        <Table caption={`Leave balances of ${employee?.fullName ?? 'employee'}`} columns={columns.filter(c=>canManage||c.key!=='act')} rowKey="leaveTypeId" rows={data.items}
          loading={state.loading} error={state.error} onRetry={refresh} empty="No leave types" />
      )}
      {employeeId && data.items.some((b) => !b.hasBalance) && <p className="muted">Unpaid leave has no annual limit.</p>}
      {data.items.some((b) => b.hasBalance) && <p className="muted">Working days only. Pending requests reserve the balance.</p>}

      {canManage && editing && <EntitlementDialog key={`${employeeId}-${editing.leaveTypeId}-${data.year}`} employee={employee} balance={editing} year={data.year}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </>
  );
}
