import {usePageRefresh} from '../../api/pageRefresh.jsx';
import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import Modal from '../../components/Modal.jsx';
import Table, { Badge, Pager } from '../../components/Table.jsx';
import { useToast } from '../../components/Toast.jsx';
import { get, post } from '../../api/client.js';
import { EMPTY_FORM, balanceView, dayWord, buildLeaveBody, leaveErrorView, requestRow, validateLeaveForm } from './leaveView.js';

const PAGE_SIZE = 10;

// Employee leave (spec 10): balances, a request form and the status of past requests. The server counts the days
// (working days minus holidays) and checks overlap and balance, so the form never sends or shows a day count in advance.
export default function Leave() {
  const pageRefresh = usePageRefresh();
  const toast = useToast();
  const [year, setYear] = useState(null); // null = let the server pick the current company year
  const [balances, setBalances] = useState({ year: null, items: [] });
  const [types, setTypes] = useState([]);
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ items: [], total: 0 });
  const [state, setState] = useState({ loading: true, error: '' });
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({ fields: {}, message: '' });
  const [busy, setBusy] = useState(false), [requesting,setRequesting]=useState(false);
  const [confirm, setConfirm] = useState(null); // { request, busy }

  useEffect(() => {
    get('/leave/types').then((r) => setTypes(r.items)).catch((e) => toast.error(`Could not load leave types: ${e.message}`));
  }, [toast, pageRefresh]);

  useEffect(() => {
    const ctrl = new AbortController();
    get('/leave/balances', { year }, { signal: ctrl.signal })
      .then((r) => { setBalances(r); if (year === null) setYear(r.year); })
      .catch((e) => { if (e.name !== 'AbortError') toast.error(`Could not load balances: ${e.message}`); });
    return () => ctrl.abort();
  }, [year, reload, toast, pageRefresh]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/leave/requests', { page, pageSize: PAGE_SIZE }, { signal: ctrl.signal })
      .then((r) => { setList(r); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, reload, pageRefresh]);

  const set = (k) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value, ...(k === 'startDate' && !f.endDate ? { endDate: value } : {}) })); // a one-day request is the common case
    setErrors((x) => ({ ...x, fields: { ...x.fields, [k]: undefined } }));
  };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const fields = validateLeaveForm(form);
    if (Object.keys(fields).length) { setErrors({ fields, message: '' }); return; }
    setBusy(true); setErrors({ fields: {}, message: '' });
    try {
      await post('/leave/requests', buildLeaveBody(form));
      toast.success('Leave request sent to HR');
      setRequesting(false); setForm(EMPTY_FORM); setPage(1); refresh();
    } catch (err) { setErrors(leaveErrorView(err)); } finally { setBusy(false); }
  }

  async function cancel() {
    setConfirm((c) => ({ ...c, busy: true }));
    try { await post(`/leave/requests/${confirm.request.id}/cancel`); toast.success('Request cancelled'); refresh(); }
    catch (err) { toast.error(leaveErrorView(err).message || err.message); refresh(); }
    finally { setConfirm(null); }
  }

  const columns = [
    { key: 'type', header: 'Type' },
    { key: 'dates', header: 'Dates', className: 'nowrap' },
    { key: 'days', header: 'Days', align: 'num' },
    { key: 'status', header: 'Status', render: (r) => (
      <span className="portal-leave-status"><Badge tone={r.tone}>{r.status}</Badge>{r.remarks && <details className="portal-leave-note"><summary aria-label="HR decision note">Note</summary><p>{r.remarks}</p></details>}</span>
    ) },
    { key: 'act', header: '', render: (r) => r.canCancel && (
      <Button size="sm" onClick={() => setConfirm({ request: r, busy: false })} aria-label={`Cancel request for ${r.dates}`}>Cancel</Button>
    ) },
  ];
  const years = balances.year ? [balances.year - 1, balances.year, balances.year + 1].map((y) => ({ value: y, label: String(y) })) : [];

  return (
    <section className="stack portal-leave-page">
      <div className="row between">
        <h1>Leave</h1>
        <div className="row portal-leave-controls">{years.length > 0 && <Field hideLabel label="Balance year" as="select" options={years} value={year ?? balances.year} disabled={busy} onChange={(e) => setYear(Number(e.target.value))} />}<Button size="sm" variant="primary" disabled={busy} onClick={()=>{setErrors({fields:{},message:''});setRequesting(true);}}>Request leave</Button></div>
      </div>
      <EmployeeLeaveBalances items={balances.items} year={balances.year}/>

      <Modal open={requesting} title="Request leave" dismissible={!busy} onClose={()=>!busy&&setRequesting(false)} footer={<><Button disabled={busy} onClick={()=>setRequesting(false)}>Cancel</Button><Button type="submit" form="employee-leave-request" variant="primary" busy={busy}>Send request</Button></>}>
      <form id="employee-leave-request" className="stack" onSubmit={submit} noValidate>
        {errors.message && <p className="form-error" role="alert">{errors.message}</p>}
        <Field as="select" label="Leave type" disabled={busy} value={form.leaveTypeId} onChange={set('leaveTypeId')} placeholder="Choose…"
          options={types.map((t) => ({ value: t.id, label: t.name }))} error={errors.fields.leaveTypeId} />
        <div className="toolbar toolbar-2">
          <Field label="From" type="date" disabled={busy} value={form.startDate} onChange={set('startDate')} error={errors.fields.startDate} />
          <Field label="To" type="date" disabled={busy} value={form.endDate} onChange={set('endDate')} error={errors.fields.endDate} />
        </div>
        <Field as="textarea" rows={2} label="Reason" disabled={busy} value={form.reason} onChange={set('reason')} maxLength={500} error={errors.fields.reason}
          hint="Working days only." />
      </form></Modal>

      <h2>Requests</h2>
      <Table caption="My leave requests" columns={columns} rows={list.items.map(requestRow)} loading={state.loading} error={state.error} onRetry={refresh}
        empty="No leave requests yet" />
      {(list.total>PAGE_SIZE||page>1)&&<Pager page={page} pageSize={PAGE_SIZE} total={list.total} onPage={setPage} disabled={state.loading} />}

      <Modal open={!!confirm} title="Cancel leave request?" onClose={() => !confirm?.busy && setConfirm(null)}
        footer={<>
          <Button onClick={() => setConfirm(null)} disabled={confirm?.busy}>Keep it</Button>
          <Button variant="danger" busy={confirm?.busy} onClick={cancel}>Cancel request</Button>
        </>}>
        <p>{confirm?.request.type}, {confirm?.request.dates}. Reserved days will be released.</p>
      </Modal>
    </section>
  );
}

export function EmployeeLeaveBalances({items,year}){
  if(!items.length)return null;
  return <ul className="leave-balances" aria-label={`Leave balances for ${year ?? 'this year'}`}>
    {items.map(balance=>{const view=balanceView(balance);return <li key={view.id} className={`card${view.empty?' leave-empty':''}`}>
      <div className="row between leave-balance-heading"><strong>{view.name}</strong><span className="leave-headline">{balance.hasBalance?`${dayWord(balance.remaining)} left`:'No limit'}</span></div>
      <small className="muted">{balance.hasBalance&&<>Total {balance.total} · </>}Used {balance.used} · Pending {balance.pending}{balance.adjusted?` · Adjustment ${balance.adjusted>0?'+':''}${balance.adjusted}`:''}{!balance.hasBalance?' · Unpaid':''}</small>
    </li>;})}
  </ul>;
}
