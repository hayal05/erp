import {usePageRefresh} from '../api/pageRefresh.jsx';
import {workspacePath} from '../api/workspaces.js';
import {useLocation} from 'react-router-dom';
import {usePermission} from '../api/auth.jsx';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { del, get } from '../api/client.js';
import PositionDialog from './PositionDialog.jsx';
import { departmentIdFromParam, plural, saveErrorView } from './departmentView.js';
import { deletePositionView, positionRow } from './positionForm.js';

const PAGE_SIZE = 20;

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const Back = () => <p><WorkspaceLink to="/hr/departments"><ArrowLeft size={14} aria-hidden="true" /> All departments</WorkspaceLink></p>;

export default function DepartmentDetail() {
  const id = departmentIdFromParam(useParams().id);
  if (id === null) return <section className="stack"><Back /><h1>Department not found</h1><p className="muted">This address does not point to a department.</p></section>;
  return <Detail key={id} id={id} />; // remount per department so no state leaks between two of them
}

function Detail({ id }) {
  const pageRefresh = usePageRefresh();
  const canManage=usePermission('organization.manage');
  const toast = useToast();
  const [department, setDepartment] = useState({ status: 'loading', value: null, error: '' });
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [state, setState] = useState({ loading: true, error: '' });
  const [dialog, setDialog] = useState(null);     // null | { position: null | item }
  const [confirm, setConfirm] = useState(null);   // null | { position, busy, error }
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // Department header and counts; refreshed after every change so the position count stays true.
  useEffect(() => {
    const ctrl = new AbortController();
    get(`/departments/${id}`, {}, { signal: ctrl.signal })
      .then((value) => setDepartment({ status: 'ready', value, error: '' }))
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setDepartment((d) => (e.status === 404 ? { status: 'missing', value: null, error: '' } : d.value ? d : { status: 'error', value: null, error: e.message }));
      });
    return () => ctrl.abort();
  }, [id, reload, pageRefresh]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get(`/departments/${id}/positions`, { page, pageSize: PAGE_SIZE, search }, { signal: ctrl.signal })
      .then((res) => { setData(res); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [id, page, search, reload, pageRefresh]);

  async function remove() {
    const { position } = confirm;
    setConfirm((c) => ({ ...c, busy: true, error: '' }));
    try {
      await del(`/positions/${position.id}`);
      toast.success(`${position.name} was deleted`);
      if (data.items.length === 1 && page > 1) setPage(page - 1);
      setConfirm(null);
      refresh();
    } catch (err) {
      setConfirm((c) => ({ ...c, busy: false, error: saveErrorView(err).message }));
      refresh();
    }
  }

  if (department.status === 'missing') return <section className="stack"><Back /><h1>Department not found</h1><p className="muted">It may have been deleted.</p></section>;
  if (department.status === 'error') {
    return <section className="stack"><Back /><h1>Department</h1><div className="form-error" role="alert">{department.error} <Button size="sm" onClick={refresh}>Try again</Button></div></section>;
  }

  const dept = department.value;
  const columns = [
    { key: 'name', header: 'Position', render: (r) => <strong>{r.name}</strong> },
    { key: 'basic', header: 'Basic salary', align: 'num' },
    { key: 'allowance', header: 'Allowance', align: 'num', render: (r) => (
      <>{r.allowance}{r.allowanceNote && <><br /><small className="muted">{r.allowanceNote}</small></>}</>
    ) },
    { key: 'pension', header: 'Pension', className: 'nowrap' },
    { key: 'employees', header: 'Employees', align: 'num' },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'nowrap', render: (r) => {
      const item = data.items.find((p) => p.id === r.id);
      return (
        <span className="row">
          <Button size="sm" onClick={() => setDialog({ position: item })} aria-label={`Edit ${r.name}`}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm({ position: item, busy: false, error: '' })} aria-label={`Delete ${r.name}`}>Delete</Button>
        </span>
      );
    } },
  ];

  const view = confirm ? deletePositionView(confirm.position) : null;

  return (
    <section className="stack">
      <Back />
      <div className="row between">
        <div>
          <h1>{dept ? dept.name : 'Department'}</h1>
          {dept && <p className="muted">{plural(dept.positionCount, 'position')} · {plural(dept.employeeCount, 'employee')}</p>}
        </div>
        {canManage && <Button variant="primary" onClick={() => setDialog({ position: null })} disabled={!dept}><Plus size={16} aria-hidden="true" /> Add position</Button>}
      </div>

      <h2>Positions and salary</h2>
      <p className="muted">Position changes do not update existing employee salaries.</p>

      <div className="toolbar">
        <Field label="Search" type="search" placeholder="Position name" value={searchText} maxLength={100}
          onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
      </div>

      <Table caption="Positions and salary" columns={columns.filter(c=>canManage||c.key!=='actions')} rows={data.items.map(positionRow)} loading={state.loading} error={state.error} onRetry={refresh}
        empty={search ? 'No positions match this search' : 'No positions yet. Add the first one.'} />
      <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} disabled={state.loading} />

      {canManage && dialog && (
        <PositionDialog key={dialog.position?.id ?? 'new'} departmentId={id} position={dialog.position}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />
      )}

      <Modal open={canManage&&!!confirm} title="Delete position?" onClose={() => !confirm?.busy && setConfirm(null)}
        footer={<>
          <Button onClick={() => setConfirm(null)} disabled={confirm?.busy}>{view?.blocked ? 'Close' : 'Cancel'}</Button>
          {!view?.blocked && <Button variant="danger" busy={confirm?.busy} onClick={remove}>Delete position</Button>}
        </>}>
        {confirm && (
          <div className="stack">
            {confirm.error && <div className="form-error" role="alert">{confirm.error}</div>}
            <p>{view.message}</p>
          </div>
        )}
      </Modal>
    </section>
  );
}

function WorkspaceLink({to,...props}){const {pathname}=useLocation();return <RouterLink to={workspacePath(to,pathname)} {...props}/>;}
