import {workspacePath} from '../api/workspaces.js';
import {useLocation} from 'react-router-dom';
import {usePermission} from '../api/auth.jsx';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { del, get } from '../api/client.js';
import DepartmentDialog from './DepartmentDialog.jsx';
import { deleteView, departmentRow, saveErrorView } from './departmentView.js';

const PAGE_SIZE = 20;

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function Departments() {
  const canManage=usePermission('organization.manage');
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [state, setState] = useState({ loading: true, error: '' });
  const [dialog, setDialog] = useState(null);     // null | { department: null | item }
  const [confirm, setConfirm] = useState(null);   // null | { department, busy, error }
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/departments', { page, pageSize: PAGE_SIZE, search }, { signal: ctrl.signal })
      .then((res) => { setData(res); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, search, reload]);

  async function remove() {
    const { department } = confirm;
    setConfirm((c) => ({ ...c, busy: true, error: '' }));
    try {
      await del(`/departments/${department.id}`);
      toast.success(`${department.name} was deleted`);
      // Deleting the last row of the last page would leave an empty page: step back one.
      if (data.items.length === 1 && page > 1) setPage(page - 1);
      setConfirm(null);
      refresh();
    } catch (err) {
      setConfirm((c) => ({ ...c, busy: false, error: saveErrorView(err).message }));
      refresh(); // the counts may have changed under us: show the truth behind the dialog
    }
  }

  const columns = [
    { key: 'name', header: 'Department', render: (r) => <strong><WorkspaceLink to={`/hr/departments/${r.id}`}>{r.name}</WorkspaceLink></strong> },
    { key: 'positions', header: 'Positions', align: 'num' },
    { key: 'employees', header: 'Employees', align: 'num' },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'nowrap', render: (r) => {
      const dept = data.items.find((d) => d.id === r.id);
      return (
        <span className="row">
          <Button size="sm" onClick={() => setDialog({ department: dept })} aria-label={`Rename ${r.name}`}>Rename</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm({ department: dept, busy: false, error: '' })} aria-label={`Delete ${r.name}`}>Delete</Button>
        </span>
      );
    } },
  ];

  const view = confirm ? deleteView(confirm.department) : null;

  return (
    <section className="stack">
      <div className="row between">
        <h1>Departments</h1>
        {canManage && <Button variant="primary" onClick={() => setDialog({ department: null })}><Plus size={16} aria-hidden="true" /> Add department</Button>}
      </div>

      <div className="toolbar">
        <Field label="Search" type="search" placeholder="Department name" value={searchText} maxLength={100}
          onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
      </div>

      <Table caption="Departments" columns={columns.filter(c=>canManage||c.key!=='actions')} rows={data.items.map(departmentRow)} loading={state.loading} error={state.error} onRetry={refresh}
        empty={search ? 'No departments match this search' : 'No departments yet. Add the first one.'} />
      <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} disabled={state.loading} />

      {canManage && dialog && (
        <DepartmentDialog key={dialog.department?.id ?? 'new'} department={dialog.department}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />
      )}

      <Modal open={canManage&&!!confirm} title="Delete department?" onClose={() => !confirm?.busy && setConfirm(null)}
        footer={<>
          <Button onClick={() => setConfirm(null)} disabled={confirm?.busy}>{view?.blocked ? 'Close' : 'Cancel'}</Button>
          {!view?.blocked && <Button variant="danger" busy={confirm?.busy} onClick={remove}>Delete department</Button>}
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
