import {usePageRefresh} from '../api/pageRefresh.jsx';
import Skeleton from '../components/Skeleton.jsx';
import {usePermission} from '../api/auth.jsx';
import { useCallback, useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Badge, Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { get } from '../api/client.js';
import CorrectionDialog from './CorrectionDialog.jsx';
import { STATUS_LABEL, STATUS_OPTIONS, STATUS_TONE, formatWorkDate } from './attendanceForm.js';

const PAGE_SIZE = 20;
const KIND_LABEL = { check_in: 'Check-in', check_out: 'Check-out' };
const NO_FILTERS = { from: '', to: '', employeeId: '', departmentId: '', status: '' };

// Selfie viewer. The signed link is requested when HR opens the photo (each view is audited on the server), kept only in this
// component's state, and dropped on close: it expires in minutes and must not be cached or stored.
function PhotoViewer({ view, onClose }) {
  const pageRefresh = usePageRefresh();
  const { record, kind } = view;
  const [state, setState] = useState({ status: 'loading', url: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading', url: '' });
    get(`/attendance-records/${record.id}/photos/${kind}`, undefined, { signal: ctrl.signal })
      .then((r) => setState({ status: 'ready', url: r.url }))
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setState({ status: 'error', url: '', message: e.status === 503 ? 'Photo storage is not available right now.' : e.message });
      });
    return () => ctrl.abort();
  }, [record.id, kind, attempt, pageRefresh]);

  const title = `${record.fullName} · ${KIND_LABEL[kind]} selfie · ${formatWorkDate(record.workDate)}`;
  return (
    <Modal open wide title={title} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="photo-view" aria-busy={state.status === 'loading' || undefined}>
        {state.status === 'loading' && <Skeleton variant="image" label="Loading photo…" />}
        {state.status === 'ready' && (
          <img className="photo-img" src={state.url} alt={`${KIND_LABEL[kind]} selfie of ${record.fullName}`}
            onError={() => setState({ status: 'error', url: '', message: 'The photo could not be loaded. The link may have expired.' })} />
        )}
        {state.status === 'error' && (
          <div className="form-error" role="alert">{state.message} <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button></div>
        )}
      </div>
    </Modal>
  );
}

export default function Attendance() {
  const pageRefresh = usePageRefresh();
  const canManage=usePermission('attendance.manage');
  const toast = useToast();
  const [view, setView] = useState('today');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, today: '' });
  const [state, setState] = useState({ loading: true, error: '' });
  const [lookups, setLookups] = useState({ departments: [], employees: [] });
  const [photo, setPhoto] = useState(null);       // null | { record, kind }
  const [correcting, setCorrecting] = useState(null); // null | record
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([get('/departments', { pageSize: 100 }, { signal: ctrl.signal }), get('/employees', { pageSize: 100 }, { signal: ctrl.signal })])
      .then(([d, e]) => setLookups({ departments: d.items, employees: e.items }))
      .catch((e) => { if (e.name !== 'AbortError') toast.error(`Could not load the filter lists: ${e.message}`); });
    return () => ctrl.abort();
  }, [toast, pageRefresh]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/attendance-records', { page, pageSize: PAGE_SIZE, ...filters, view }, { signal: ctrl.signal })
      .then((res) => { if (ctrl.signal.aborted) return; setData(res); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, filters, view, reload, pageRefresh]);

  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const rangeBad = filters.from && filters.to && filters.from > filters.to;
  const filtered = Object.values(filters).some(Boolean);

  const columns = [
    { key: 'workDate', header: 'Date', className: 'nowrap', render: (r) => formatWorkDate(r.workDate) },
    { key: 'fullName', header: 'Employee', render: (r) => <span className="attendance-person"><strong>{r.fullName}</strong><small className="muted">{r.employeeCode}</small></span> },
    { key: 'departmentName', header: 'Department', render: (r) => r.departmentName ?? '—' },
    { key: 'checkInTime', header: 'In', className: 'nowrap', render: (r) => r.checkInTime ?? '—' },
    { key: 'checkOutTime', header: 'Out', className: 'nowrap', render: (r) => r.checkOutTime ?? '—' },
    { key: 'status', header: 'Status', render: (r) => (
      <>
        <span className="attendance-status"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        {r.status === 'late' && r.lateMinutes > 0 && <small className="muted">{r.lateMinutes} min late</small>}
        {r.correctedAt && <small className="muted" title={`Corrected by ${r.correctedByName ?? 'HR'}: ${r.correctionReason ?? ''}`}>Corrected</small>}
        </span>
      </>
    ) },
    { key: 'photos', header: 'Selfies', className: 'nowrap', render: (r) => (
      <span className="row">
        {['check_in', 'check_out'].map((kind) => {
          const has = kind === 'check_in' ? r.hasCheckInPhoto : r.hasCheckOutPhoto;
          return has
            ? <Button key={kind} size="sm" onClick={() => setPhoto({ record: r, kind })} aria-label={`View ${KIND_LABEL[kind].toLowerCase()} selfie of ${r.fullName}`}><Camera size={14} aria-hidden="true" /> {kind === 'check_in' ? 'In' : 'Out'}</Button>
            : null;
        })}
        {!r.hasCheckInPhoto && !r.hasCheckOutPhoto && <span className="muted">None</span>}
      </span>
    ) },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'nowrap', render: (r) => (
      <Button size="sm" onClick={() => setCorrecting(r)} aria-label={`Correct attendance of ${r.fullName} on ${formatWorkDate(r.workDate)}`}>Correct</Button>
    ) },
  ];

  return (
    <section className="stack attendance-page">
      <div className="row between attendance-heading">
        <div className="row"><h1>Attendance</h1>{view === 'today' && data.today && <time className="muted" dateTime={data.today}>{formatWorkDate(data.today)}</time>}</div>
        <div className="row">
          <Button size="sm" variant={view === 'today' ? 'primary' : 'default'} aria-pressed={view === 'today'} onClick={() => { setView('today'); setFilters(NO_FILTERS); setPage(1); }}>Today</Button>
          <Button size="sm" variant={view === 'archive' ? 'primary' : 'default'} aria-pressed={view === 'archive'} onClick={() => { setView('archive'); setFilters(NO_FILTERS); setPage(1); }}>Archive</Button>
          {filtered && <Button size="sm" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear filters</Button>}
        </div>
      </div>

      <div className={`attendance-filters${view === 'archive' ? ' archive' : ''}`}>
        {view === 'archive' && <><Field label="From" type="date" value={filters.from} onChange={setFilter('from')} />
        <Field label="To" type="date" value={filters.to} onChange={setFilter('to')} error={rangeBad ? 'Must be on or after the start date' : undefined} /></>}
        <Field as="select" hideLabel label="Employee" placeholder="All employees" value={filters.employeeId} onChange={setFilter('employeeId')}
          options={lookups.employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))} />
        <Field as="select" hideLabel label="Department" placeholder="All departments" value={filters.departmentId} onChange={setFilter('departmentId')}
          options={lookups.departments.map((d) => ({ value: d.id, label: d.name }))} />
        <Field as="select" hideLabel label="Status" placeholder="All statuses" value={filters.status} onChange={setFilter('status')} options={STATUS_OPTIONS} />
      </div>

      <Table caption={view === 'today' ? "Today's attendance" : 'Attendance archive'} columns={columns.filter(c=>canManage||c.key!=='actions')} rows={rangeBad ? [] : data.items} loading={state.loading} error={state.error} onRetry={refresh}
        empty={filtered ? 'No attendance records match these filters' : view === 'today' ? 'No attendance recorded today' : 'No archived attendance records'} />
      <Pager page={page} pageSize={PAGE_SIZE} total={rangeBad ? 0 : data.total} onPage={setPage} disabled={state.loading} />

      {photo && <PhotoViewer key={`${photo.record.id}-${photo.kind}`} view={photo} onClose={() => setPhoto(null)} />}
      {canManage && correcting && <CorrectionDialog key={correcting.id} record={correcting} onClose={() => setCorrecting(null)} onSaved={() => { setCorrecting(null); refresh(); }} />}
    </section>
  );
}
