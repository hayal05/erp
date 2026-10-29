import {useAuth} from '../api/auth.jsx';
import {allowed} from '../api/workspaces.js';
import {workspacePath,workspaceArea} from '../api/workspaces.js';
import PayrollExportButton from './PayrollExportButton.jsx';
import PayrollWorkflowDialog from './PayrollWorkflowDialog.jsx';
import { localDate, validMonth, workflowAction } from './payrollWorkflowView.js';
import SalaryDetailDialog from './SalaryDetailDialog.jsx';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Badge, Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { get, patch } from '../api/client.js';
import { formatMoney } from '../api/money.js';
import { SALARY_COLUMNS, canEditSalary, periodIdFromParam, salaryEditForm, salaryEditPayload } from './salarySheetView.js';
const PAGE_SIZE = 25;
export default function Payroll() {
  const {user}=useAuth();
  const {pathname}=useLocation();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const requestedMonth = params.get('month');
  const selected = periodIdFromParam(params.get('period'));
  const [page, setPage] = useState(1), [reload, setReload] = useState(0), [editing, setEditing] = useState(null), [details, setDetails] = useState(null), [workflow, setWorkflow] = useState(null);
  const [state, setState] = useState({ loading: true, error: '', period: null, entries: [], total: 0 });
  useEffect(() => { setPage(1); setEditing(null); setDetails(null); setWorkflow(null); }, [selected, requestedMonth]);
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ loading: true, error: '', period: null, entries: [], total: 0 });
    async function load() {
      if (requestedMonth !== null && !validMonth(requestedMonth)) throw new Error('Invalid payroll month in the link. Choose a month below.');
      if (selected === false && requestedMonth === null) throw new Error('Invalid payroll period in the link. Open Payroll from the sidebar to view the latest period.');
      let id = requestedMonth === null ? selected : null;
      if (id == null) id = (await get('/payroll/periods', { pageSize: 1, month: requestedMonth ?? undefined }, { signal: ctrl.signal })).items[0]?.id;
      if (!id) return { period: null, entries: [], total: 0 };
      const [period, result] = await Promise.all([
        get(`/payroll/periods/${id}`, {}, { signal: ctrl.signal }),
        get(`/payroll/periods/${id}/entries`, { page, pageSize: PAGE_SIZE }, { signal: ctrl.signal }),
      ]);
      return { period, entries: result.items, total: result.total };
    }
    load().then((data) => { if (!ctrl.signal.aborted) setState({ ...data, loading: false, error: '' }); })
      .catch((e) => { if (!ctrl.signal.aborted) setState({ loading: false, error: e.message, period: null, entries: [], total: 0 }); });
    return () => ctrl.abort();
  }, [selected, requestedMonth, page, reload]);
  const editable = canEditSalary(state.period) && !state.loading && allowed(user,'payroll.prepare');
  const columns = SALARY_COLUMNS.map((col, index) => ({ ...col, align: index > 1 ? 'num' : undefined, className: index < 2 ? 'nowrap' : undefined,
    render: index === 1 ? (entry) => <button type="button" className="salary-name" onClick={() => setDetails({ periodId: state.period.id, entry })} aria-label={`View salary details for ${entry.employeeName}`}>{entry.employeeName}</button> : index === 0 ? undefined : (entry) => col.editable && editable ?
      <button type="button" className="salary-cell" onClick={() => setEditing({ entry, field: col.key, period: state.period })} aria-label={`Edit ${col.header.toLowerCase()} for ${entry.employeeName}`}>
        {formatMoney(entry[col.key])}<Pencil size={12} aria-hidden="true" />
      </button> : <span className={col.key === 'netMinor' && entry.netMinor < 0 ? 'salary-negative' : undefined}>{formatMoney(entry[col.key])}</span>,
  }));
  const refresh = () => setReload((n) => n + 1);
  const shownMonth = validMonth(requestedMonth) ? requestedMonth : state.period?.month ?? localDate().slice(0,7);
  const proposedAction = state.error ? null : workflowAction(state.period, state.loading, state.total);
  const action = allowed(user,({generate:'payroll.prepare',approve:'payroll.approve',pay:'payroll.pay'})[proposedAction]) ? proposedAction : null;
  const chooseMonth = (e) => { if (validMonth(e.target.value)) { setPage(1); setParams({ month: e.target.value }); } };
  const actionLabel = { generate: 'Generate draft', approve: 'Approve payroll', pay: 'Mark paid' };
  const openWorkflow = () => setWorkflow({ action, month: shownMonth, period: state.period, total: state.total });
  return <section className="stack salary-sheet">
    <div className="row between"><h1>Payroll</h1><div className="row">{allowed(user,'company_costs.read') && <Link className="btn" to={workspacePath('/hr/payroll/company-costs',pathname)}>Company costs</Link>}<Link to={workspacePath('/hr/settings/payroll',pathname)}>Payroll settings</Link></div></div>
    <div className="row between payroll-controls">
      <Field label="Payroll month" type="month" min="1000-01" max="9999-12" value={shownMonth} onChange={chooseMonth} disabled={!!workflow} />
      <div className="row">{state.period && !state.loading && !state.error && <PayrollExportButton key={state.period.id} period={state.period} disabled={!!workflow} />}
      {editable && <Button onClick={() => setWorkflow({ action: 'regenerate', month: state.period.month, period: state.period, total: state.total })} disabled={!!workflow}>Regenerate payroll</Button>}
      {action && <Button variant="primary" onClick={openWorkflow} disabled={!!workflow}>{actionLabel[action]}</Button>}</div>
    </div>
    {state.period?.status === 'paid' && <p className="muted" role="status">Paid on {state.period.paidOn}. This payroll is locked.</p>}
    {state.period && <div className="row between"><div className="row"><h2>Salary sheet · {state.period.month}</h2><Badge tone={editable ? 'warn' : 'ok'}>{state.period.status === 'draft' ? 'Draft' : state.period.status === 'approved' ? 'Approved' : 'Paid'}</Badge></div><span className="muted">Amounts in {state.period.configSnapshot?.settings?.currencyCode ?? 'ETB'}</span></div>}
    {state.period && <p className="muted">{editable ? 'Select salary or allowance to edit.' : 'Payroll locked.'} Select a name for details.</p>}
    <Table caption="Salary sheet" columns={columns} rows={state.entries} loading={state.loading} error={state.error} onRetry={refresh}
      empty={state.period ? 'No salary entries in this period.' : `No payroll for ${shownMonth}. Generate a draft to view the salary sheet.`} />
    {state.period && <Pager page={page} pageSize={PAGE_SIZE} total={state.total} onPage={setPage} disabled={state.loading} />}
    {workflow && <PayrollWorkflowDialog {...workflow} onClose={() => setWorkflow(null)} onReload={() => { setWorkflow(null); refresh(); }} onSaved={(saved) => { setWorkflow(null); setEditing(null); setDetails(null); setPage(1); setParams({ month: saved.month }); refresh(); toast.success(saved.status === 'draft' ? (workflow.action === 'regenerate' ? 'Payroll regenerated' : 'Draft payroll generated') : saved.status === 'approved' ? 'Payroll approved' : 'Payment recorded'); }} />}
    {details && <SalaryDetailDialog key={`${details.periodId}-${details.entry.id}`} {...details} onClose={() => setDetails(null)} />}
    {editing && <SalaryEditDialog key={`${editing.period.id}-${editing.entry.id}`} {...editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} onConflict={() => { setEditing(null); refresh(); }} />}
  </section>;
}
function SalaryEditDialog({ period, entry, field, onClose, onSaved, onConflict }) {
  const [form, setForm] = useState(() => salaryEditForm(entry)), [errors, setErrors] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    const result = salaryEditPayload(form); setErrors(result.errors ?? {}); setError('');
    if (result.errors) return;
    setBusy(true);
    try { await patch(`/payroll/periods/${period.id}/entries/${entry.id}`, result.value); toast.success('Salary recalculated'); onSaved(); }
    catch (e) {
      if (e.status === 409 || e.status === 404) { toast.error(e.message); onConflict(); }
      else { setErrors(e.fields ?? {}); setError(e.message); }
    } finally { setBusy(false); }
  }
  return <Modal open title={`Edit salary — ${entry.employeeName}`} onClose={() => !busy && onClose()} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" form="salary-entry-edit" type="submit" busy={busy}>Save and recalculate</Button></>}>
    <form id="salary-entry-edit" className="stack" onSubmit={submit} noValidate>
      <p>{entry.employeeCode} · {period.month}. This payroll only.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {['basicMinor','allowanceMinor'].map((key) => <Field key={key} label={key === 'basicMinor' ? 'Basic salary' : 'Allowance'} inputMode="decimal" autoFocus={field === key} value={form[key]} disabled={busy} error={errors[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />)}
      <p className="muted">Totals recalculate on save. Salary profile stays unchanged.</p>
    </form>
  </Modal>;
}
