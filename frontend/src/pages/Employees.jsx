import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Badge, Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { get, post } from '../api/client.js';
import SalaryProfileDialog from './SalaryProfileDialog.jsx';
import EmployeeDialog from './EmployeeDialog.jsx';

const PAGE_SIZE = 20;
const TYPE_LABEL = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract', intern: 'Intern' };

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function Employees() {
  const toast = useToast();
  const [filters, setFilters] = useState({ search: '', status: '', departmentId: '' });
  const [page, setPage] = useState(1);
  const search = useDebounced(filters.search);
  const [data, setData] = useState({ items: [], total: 0 });
  const [state, setState] = useState({ loading: true, error: '' });
  const [lookups, setLookups] = useState({ departments: [], shifts: [] });
  const [dialog, setDialog] = useState(null);       // null | { employee: null | row }
  const [salaryEmployee, setSalaryEmployee] = useState(null);
  const [confirm, setConfirm] = useState(null);     // null | { employee, reason, busy }
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // Dropdown sources. Both lists are small; the API caps pageSize at 100.
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([get('/departments', { pageSize: 100 }, { signal: ctrl.signal }), get('/shifts', { pageSize: 100 }, { signal: ctrl.signal })])
      .then(([d, s]) => setLookups({ departments: d.items, shifts: s.items }))
      .catch((e) => { if (e.name !== 'AbortError') toast.error(`Could not load departments and shifts: ${e.message}`); });
    return () => ctrl.abort();
  }, [toast, reload]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/employees', { page, pageSize: PAGE_SIZE, search, status: filters.status, departmentId: filters.departmentId }, { signal: ctrl.signal })
      .then((res) => { setData(res); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, search, filters.status, filters.departmentId, reload]);

  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };

  async function changeStatus(employee, action, reason) {
    try {
      await post(`/employees/${employee.id}/${action}`, reason ? { reason } : {});
      toast.success(`${employee.fullName} was ${action === 'activate' ? 'activated' : 'deactivated'}`);
      setConfirm(null);
      refresh();
    } catch (e) {
      toast.error(e.message);
      setConfirm((c) => c && { ...c, busy: false });
    }
  }

  const columns = [
    { key: 'employeeCode', header: 'ID', className: 'nowrap' },
    { key: 'fullName', header: 'Name', render: (r) => <><strong>{r.fullName}</strong><br /><small className="muted">{r.email}</small></> },
    { key: 'departmentName', header: 'Department', render: (r) => r.departmentName ?? '—' },
    { key: 'jobTitle', header: 'Title', render: (r) => r.jobTitle ?? '—' },
    { key: 'employmentType', header: 'Type', className: 'nowrap', render: (r) => TYPE_LABEL[r.employmentType] },
    { key: 'shiftName', header: 'Shift', className: 'nowrap' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'ok' : 'neutral'}>{r.status === 'active' ? 'Active' : 'Inactive'}</Badge> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'nowrap', render: (r) => (
      <span className="row">
        <Button size="sm" onClick={() => setDialog({ employee: r })} aria-label={`Edit ${r.fullName}`}>Edit</Button>
        <Button size="sm" onClick={() => setSalaryEmployee(r)} aria-label={`Salary for ${r.fullName}`}>Salary</Button>
        {r.status === 'active'
          ? <Button size="sm" variant="danger" onClick={() => setConfirm({ employee: r, reason: '', busy: false })} aria-label={`Deactivate ${r.fullName}`}>Deactivate</Button>
          : <Button size="sm" onClick={() => changeStatus(r, 'activate')} aria-label={`Activate ${r.fullName}`}>Activate</Button>}
      </span>
    ) },
  ];

  return (
    <section className="stack">
      <div className="row between">
        <h1>Employees</h1>
        <Button variant="primary" onClick={() => setDialog({ employee: null })} disabled={!lookups.shifts.length}
          title={lookups.shifts.length ? undefined : 'Create a shift first (Settings)'}><Plus size={16} aria-hidden="true" /> Add employee</Button>
      </div>

      <div className="toolbar">
        <Field label="Search" type="search" placeholder="Name, email or ID" value={filters.search} onChange={setFilter('search')} maxLength={100} />
        <Field as="select" label="Department" placeholder="All departments" value={filters.departmentId} onChange={setFilter('departmentId')}
          options={lookups.departments.map((d) => ({ value: d.id, label: d.name }))} />
        <Field as="select" label="Status" placeholder="All statuses" value={filters.status} onChange={setFilter('status')}
          options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
      </div>

      <Table caption="Employees" columns={columns} rows={data.items} loading={state.loading} error={state.error} onRetry={refresh}
        empty={filters.search || filters.status || filters.departmentId ? 'No employees match these filters' : 'No employees yet. Add the first one.'} />
      <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} disabled={state.loading} />

      {dialog && (
        <EmployeeDialog key={dialog.employee?.id ?? 'new'} employee={dialog.employee} departments={lookups.departments} shifts={lookups.shifts}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />
      )}

      {salaryEmployee && <SalaryProfileDialog key={salaryEmployee.id} employee={salaryEmployee} onClose={() => setSalaryEmployee(null)} />}

      <Modal open={!!confirm} title="Deactivate employee?" onClose={() => !confirm?.busy && setConfirm(null)}
        footer={<>
          <Button onClick={() => setConfirm(null)} disabled={confirm?.busy}>Cancel</Button>
          <Button variant="danger" busy={confirm?.busy} onClick={() => { setConfirm((c) => ({ ...c, busy: true })); changeStatus(confirm.employee, 'deactivate', confirm.reason.trim()); }}>Deactivate</Button>
        </>}>
        {confirm && (
          <div className="stack">
            <p>{confirm.employee.fullName} will be signed out and blocked from login. Records are kept.</p>
            <Field as="textarea" label="Reason (optional)" maxLength={500} value={confirm.reason} onChange={(e) => setConfirm((c) => ({ ...c, reason: e.target.value }))} />
          </div>
        )}
      </Modal>
    </section>
  );
}
