import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import Modal from '../../components/Modal.jsx';
import Table, { Badge, Pager } from '../../components/Table.jsx';
import { useToast } from '../../components/Toast.jsx';
import { get, post } from '../../api/client.js';
import { EMPTY_FORM, balanceView, buildLeaveBody, leaveErrorView, requestRow, validateLeaveForm } from './leaveView.js';

const PAGE_SIZE = 10;

// Employee leave (spec 10): balances, a request form and the status of past requests. The server counts the days
// (working days minus holidays) and checks overlap and balance, so the form never sends or shows a day count in advance.
export default function Leave() {
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
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { request, busy }

  useEffect(() => {
    get('/leave/types').then((r) => setTypes(r.items)).catch((e) => toast.error(`Could not load leave types: ${e.message}`));
  }, [toast]);

  useEffect(() => {
    const ctrl = new AbortController();
    get('/leave/balances', { year }, { signal: ctrl.signal })
      .then((r) => { setBalances(r); if (year === null) setYear(r.year); })
      .catch((e) => { if (e.name !== 'AbortError') toast.error(`Could not load balances: ${e.message}`); });
    return () => ctrl.abort();
  }, [year, reload, toast]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/leave/requests', { page, pageSize: PAGE_SIZE }, { signal: ctrl.signal })
      .then((r) => { setList(r); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, reload]);

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
      setForm(EMPTY_FORM); setPage(1); refresh();
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
      <>
        <Badge tone={r.tone}>{r.status}</Badge>
        {r.remarks && <><br /><small className="muted">HR: {r.remarks}</small></>}
      </>
    ) },
    { key: 'act', header: '', render: (r) => r.canCancel && (
      <Button size="sm" onClick={() => setConfirm({ request: r, busy: false })} aria-label={`Cancel request for ${r.dates}`}>Cancel</Button>
    ) },
  ];
  const years = balances.year ? [balances.year - 1, balances.year, balances.year + 1].map((y) => ({ value: y, label: String(y) })) : [];

  return (
    <section className="stack">
      <div className="row between">
        <h1>Leave</h1>
        {years.length > 0 && <Field label="Year" as="select" options={years} value={year ?? balances.year} onChange={(e) => setYear(Number(e.target.value))} />}
      </div>

      <ul className="leave-balances" aria-label={`Leave balances for ${balances.year ?? 'this year'}`}>
        {balances.items.map(balanceView).map((b) => (
          <li key={b.id} className={`card${b.empty ? ' leave-empty' : ''}`}>
            <strong>{b.name}</strong>
            <span className="leave-headline">{b.headline}</span>
            <small className="muted">{b.detail}</small>
          </li>
        ))}
      </ul>

      <form className="card stack" onSubmit={submit} noValidate aria-label="Request leave">
        <h2>Request leave</h2>
        {errors.message && <p className="form-error" role="alert">{errors.message}</p>}
        <Field as="select" label="Leave type" value={form.leaveTypeId} onChange={set('leaveTypeId')} placeholder="Choose…"
          options={types.map((t) => ({ value: t.id, label: t.name }))} error={errors.fields.leaveTypeId} />
        <div className="toolbar toolbar-2">
          <Field label="From" type="date" value={form.startDate} onChange={set('startDate')} error={errors.fields.startDate} />
          <Field label="To" type="date" value={form.endDate} onChange={set('endDate')} error={errors.fields.endDate} />
        </div>
        <Field as="textarea" rows={3} label="Reason" value={form.reason} onChange={set('reason')} maxLength={500} error={errors.fields.reason}
          hint="Days off and company holidays are not counted. HR will approve or reject your request." />
        <Button type="submit" variant="primary" busy={busy}>Send request</Button>
      </form>

      <h2>My requests</h2>
      <Table caption="My leave requests" columns={columns} rows={list.items.map(requestRow)} loading={state.loading} error={state.error} onRetry={refresh}
        empty="No leave requests yet" />
      <Pager page={page} pageSize={PAGE_SIZE} total={list.total} onPage={setPage} disabled={state.loading} />

      <Modal open={!!confirm} title="Cancel this request?" onClose={() => !confirm?.busy && setConfirm(null)}
        footer={<>
          <Button onClick={() => setConfirm(null)} disabled={confirm?.busy}>Keep it</Button>
          <Button variant="danger" busy={confirm?.busy} onClick={cancel}>Cancel request</Button>
        </>}>
        <p>{confirm?.request.type}, {confirm?.request.dates}. The days go back to your balance.</p>
      </Modal>
    </section>
  );
}
