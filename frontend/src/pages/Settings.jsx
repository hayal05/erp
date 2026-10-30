import {usePageRefresh} from '../api/pageRefresh.jsx';
import {workspacePath} from '../api/workspaces.js';
import {useLocation} from 'react-router-dom';
import {usePermission} from '../api/auth.jsx';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { del, get } from '../api/client.js';
import { HolidayDialog, ShiftDialog } from './SettingsDialogs.jsx';
import { formatWorkDate } from './attendanceForm.js';
import { saveErrorView, shiftRow } from './settingsView.js';

// HR settings (spec 8): company holidays and working schedules. Both change how leave days are counted for requests made from now on.
// (Payroll settings join this page in Phase 4.)
export default function Settings() {
  const [section,setSection]=useState('holidays');
  return (
    <section className="stack general-settings-page">
      <div className="row between"><h1>Settings</h1><WorkspaceLink className="btn sm" to="/hr/settings/payroll">Payroll settings</WorkspaceLink></div>
      <div className="row" role="group" aria-label="Settings sections"><Button size="sm" variant={section==='holidays'?'primary':'default'} aria-pressed={section==='holidays'} onClick={()=>setSection('holidays')}>Holidays</Button><Button size="sm" variant={section==='schedules'?'primary':'default'} aria-pressed={section==='schedules'} onClick={()=>setSection('schedules')}>Schedules</Button></div>
      <div hidden={section!=='holidays'}><Holidays /></div>
      <div hidden={section!=='schedules'}><Schedules /></div>
    </section>
  );
}

function Holidays() {
  const pageRefresh = usePageRefresh();
  const canManage=usePermission('organization.manage');
  const toast = useToast();
  const [year, setYear] = useState(null); // null = the server's current company year
  const [data, setData] = useState({ year: null, items: [] });
  const [state, setState] = useState({ loading: true, error: '' });
  const [dialog, setDialog] = useState(null);   // null | { holiday: null | {…} }
  const [removing, setRemoving] = useState(null); // null | { holiday, busy }
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/settings/holidays', { year }, { signal: ctrl.signal })
      .then((r) => { setData(r); if (year === null) setYear(r.year); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [year, reload, pageRefresh]);

  async function remove() {
    setRemoving((r) => ({ ...r, busy: true }));
    try { await del(`/settings/holidays/${removing.holiday.id}`); toast.success('Holiday deleted'); }
    catch (err) { toast.error(saveErrorView(err).message || err.message); }
    finally { setRemoving(null); refresh(); }
  }

  const years = data.year ? [data.year - 1, data.year, data.year + 1].map((y) => ({ value: y, label: String(y) })) : [];
  const columns = [
    { key: 'date', header: 'Date', className: 'nowrap', render: (h) => formatWorkDate(h.date) },
    { key: 'name', header: 'Holiday' },
    { key: 'act', header: <span className="sr-only">Actions</span>, className: 'nowrap', render: (h) => (
      <span className="row">
        <Button size="sm" onClick={() => setDialog({ holiday: h })} aria-label={`Edit ${h.name}`}>Edit</Button>
        <Button size="sm" onClick={() => setRemoving({ holiday: h, busy: false })} aria-label={`Delete ${h.name}`}>Delete</Button>
      </span>
    ) },
  ];

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="sr-only">Holidays</h2>
        <div className="row">
          {years.length > 0 && <Field hideLabel label="Year" as="select" options={years} value={year ?? data.year} onChange={(e) => setYear(Number(e.target.value))} />}
          {canManage && <Button size="sm" variant="primary" onClick={() => setDialog({ holiday: null })} disabled={!data.year}><Plus size={16} aria-hidden="true" /> Add holiday</Button>}
        </div>
      </div>
      <Table caption={`Holidays in ${data.year ?? 'the year'}`} columns={columns.filter(c=>canManage||c.key!=='act')} rows={data.items} loading={state.loading} error={state.error} onRetry={refresh}
        empty="No holidays set for this year" />

      {canManage && dialog && <HolidayDialog key={dialog.holiday?.id ?? 'new'} holiday={dialog.holiday} year={data.year} onClose={() => setDialog(null)}
        onSaved={(h) => { setDialog(null); if (Number(h.date.slice(0, 4)) !== data.year) setYear(Number(h.date.slice(0, 4))); else refresh(); }} />}
      <Modal open={canManage&&!!removing} title="Delete this holiday?" onClose={() => !removing?.busy && setRemoving(null)}
        footer={<>
          <Button onClick={() => setRemoving(null)} disabled={removing?.busy}>Keep it</Button>
          <Button variant="danger" busy={removing?.busy} onClick={remove}>Delete holiday</Button>
        </>}>
        <p>{removing?.holiday.name}, {removing && formatWorkDate(removing.holiday.date)}. Future leave requests will treat it as a working day.</p>
      </Modal>
    </div>
  );
}

function Schedules() {
  const pageRefresh = usePageRefresh();
  const canManage=usePermission('organization.manage');
  const [list, setList] = useState({ items: [] });
  const [state, setState] = useState({ loading: true, error: '' });
  const [dialog, setDialog] = useState(null); // null | { shift: null | {…} }
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/shifts', { pageSize: 100 }, { signal: ctrl.signal })
      .then((r) => { setList(r); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [reload, pageRefresh]);

  const columns = [
    { key: 'name', header: 'Schedule', render: (s) => <strong>{s.name}</strong> },
    { key: 'days', header: 'Work days' },
    { key: 'hours', header: 'Hours', className: 'nowrap' },
    { key: 'grace', header: 'Grace', className: 'nowrap' },
    { key: 'count', header: 'Employees', align: 'num' },
    { key: 'act', header: <span className="sr-only">Actions</span>, render: (s) => (
      <Button size="sm" onClick={() => setDialog({ shift: list.items.find((x) => x.id === s.id) })} aria-label={`Edit schedule ${s.name}`}>Edit</Button>
    ) },
  ];

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="sr-only">Working schedules</h2>
        {canManage && <Button size="sm" variant="primary" onClick={() => setDialog({ shift: null })}><Plus size={16} aria-hidden="true" /> Add schedule</Button>}
      </div>
      <Table caption="Working schedules" columns={columns.filter(c=>canManage||c.key!=='act')} rows={list.items.map(shiftRow)} loading={state.loading} error={state.error} onRetry={refresh}
        empty="No schedules yet. Add one before adding employees." />

      {canManage && dialog && <ShiftDialog key={dialog.shift?.id ?? 'new'} shift={dialog.shift} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
    </div>
  );
}

function WorkspaceLink({to,...props}){const {pathname}=useLocation();return <RouterLink to={workspacePath(to,pathname)} {...props}/>;}
