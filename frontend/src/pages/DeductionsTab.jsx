import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Badge } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { del, patch, post } from '../api/client.js';
import { formatMoney } from '../api/money.js';
import { useResource } from './payrollResource.jsx';
import { saveErrorView } from './settingsView.js';
import { DEDUCTION_KIND_OPTIONS, EMPTY_DEDUCTION, buildDeductionCreate, buildDeductionPatch, deductionForm, deductionKindLabel, deductionStatus,
  deductionTone, employeeFromParam, employeeLabel, isConsumed, serverDeductionErrors, validateDeduction } from './payrollSettingsView.js';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// Other Deductions tab (spec 16): advances, loans, penalties and other amounts taken from one employee's pay.
// Items belong to an employee, so the tab starts with a picker (kept in ?employee= so a refresh stays on the same person).
// One-time items apply to the next payroll only; once a payroll has used one it is history and the server refuses edits (409).
export default function DeductionsTab({ readOnly = false }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const employeeId = employeeFromParam(params.get('employee'));
  const [find, setFind] = useState('');
  const search = useDebounced(find.trim());
  const people = useResource('/employees', { search, pageSize: 100 });
  const list = useResource(employeeId ? '/deductions' : null, { employeeId });
  const [dialog, setDialog] = useState(null);     // null | { item: null | {…} }
  const [removing, setRemoving] = useState(null); // null | { item, busy }
  const [toggling, setToggling] = useState(null); // id being paused/resumed

  const employees = people.data?.items ?? [];
  // Keep the chosen person selectable even when the search box has filtered them out of the list.
  const chosen = employees.find((e) => String(e.id) === employeeId);
  const options = [...(!chosen && employeeId ? [{ value: employeeId, label: `Employee #${employeeId}` }] : []), ...employees.map((e) => ({ value: e.id, label: employeeLabel(e) }))];
  const pick = (e) => setParams(e.target.value ? { tab: 'other-deductions', employee: e.target.value } : { tab: 'other-deductions' }, { replace: true });

  const failed = (err) => { toast.error(err?.status === 409 ? 'A payroll has already used this item, so it can no longer be changed.' : saveErrorView(err).message || err.message); };
  async function toggle(d) {
    setToggling(d.id);
    try { await patch(`/deductions/${d.id}`, { enabled: !d.enabled }); toast.success(d.enabled ? `${d.name} paused` : `${d.name} resumed`); }
    catch (err) { failed(err); }
    finally { setToggling(null); list.reload(); }
  }
  async function remove() {
    setRemoving((r) => ({ ...r, busy: true }));
    try { await del(`/deductions/${removing.item.id}`); toast.success('Deduction deleted'); }
    catch (err) { failed(err); }
    finally { setRemoving(null); list.reload(); }
  }

  const columns = [
    { key: 'name', header: 'Deduction', render: (d) => <span className="deduction-name"><strong>{d.name}</strong><small className="muted">{deductionKindLabel(d.kind)}</small></span> },
    { key: 'amount', header: 'Amount', align: 'num', render: (d) => formatMoney(d.amountMinor) },
    { key: 'state', header: 'Applies', render: (d) => <Badge tone={deductionTone(d)}>{deductionStatus(d)}</Badge> },
    { key: 'act', header: <span className="sr-only">Actions</span>, className: 'nowrap', render: (d) => (isConsumed(d)
      ? <small className="muted">Applied</small>
      : (
        <span className="row">
          <Button size="sm" disabled={readOnly} busy={toggling === d.id} onClick={() => toggle(d)} aria-label={`${d.enabled ? 'Pause' : 'Resume'} ${d.name}`}>{d.enabled ? 'Pause' : 'Resume'}</Button>
          <Button size="sm" disabled={readOnly} onClick={() => setDialog({ item: d })} aria-label={`Edit ${d.name}`}>Edit</Button>
          <Button size="sm" disabled={readOnly} onClick={() => setRemoving({ item: d, busy: false })} aria-label={`Delete ${d.name}`}>Delete</Button>
        </span>
      )) },
  ];

  return (
    <div className="stack">
      <div className="row between">
        <h2>Other deductions</h2>
        <Button size="sm" variant="primary" disabled={readOnly || !employeeId || !list.data} onClick={() => setDialog({ item: null })}><Plus size={16} aria-hidden="true" /> Add deduction</Button>
      </div>

      <div className="deduction-picker">
        <Field label="Find employee" type="search" autoComplete="off" placeholder="Name or ID" value={find} onChange={(e) => setFind(e.target.value)} />
        <Field as="select" hideLabel label="Employee" value={employeeId} placeholder="Choose an employee…" options={options} onChange={pick} disabled={people.loading && !employees.length} error={people.error || undefined} />
      </div>

      {employeeId && (
        <>
          <Table caption="Deductions" columns={columns} rows={list.data?.items ?? []} loading={list.loading} error={list.error} onRetry={list.reload} empty="No deductions for this employee" />
          <small className="muted">One-time: next draft. Monthly: repeats until paused or deleted.</small>
        </>
      )}

      {dialog && <DeductionDialog key={dialog.item?.id ?? 'new'} item={dialog.item} employeeId={Number(employeeId)} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); list.reload(); }} onConflict={() => { setDialog(null); list.reload(); }} />}
      <Modal open={!!removing} title="Delete this deduction?" onClose={() => !removing?.busy && setRemoving(null)}
        footer={<><Button onClick={() => setRemoving(null)} disabled={removing?.busy}>Keep it</Button><Button variant="danger" busy={removing?.busy} onClick={remove}>Delete deduction</Button></>}>
        <p>{removing?.item.name} ({removing && formatMoney(removing.item.amountMinor)}) will be removed from future drafts.</p>
      </Modal>
    </div>
  );
}

function DeductionDialog({ item, employeeId, onClose, onSaved, onConflict }) {
  const toast = useToast();
  const [form, setForm] = useState(() => (item ? deductionForm(item) : EMPTY_DEDUCTION));
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setFields((x) => ({ ...x, [k]: undefined })); };
  const check = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validateDeduction(form);
    setFields(problems); setError('');
    if (Object.keys(problems).length) return;
    const body = item ? buildDeductionPatch(form, item) : buildDeductionCreate(form, employeeId);
    if (item && !Object.keys(body).length) { setError('Nothing was changed.'); return; }
    setBusy(true);
    try {
      if (item) await patch(`/deductions/${item.id}`, body); else await post('/deductions', body);
      toast.success(item ? 'Deduction updated' : 'Deduction added'); onSaved();
    } catch (err) {
      if (err?.status === 409) { toast.error('A payroll has already used this item, so it can no longer be changed.'); onConflict(); return; }
      const v = saveErrorView(err);
      setFields(serverDeductionErrors(v.fields)); setError(v.message || 'Please fix the highlighted fields.'); setBusy(false);
    }
  }

  return (
    <Modal open title={item ? 'Edit deduction' : 'Add deduction'} onClose={() => !busy && onClose()}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="deduction-form" busy={busy}>Save</Button></>}>
      <form id="deduction-form" className="form-grid" onSubmit={submit} noValidate>
        {error && <div className="form-error full" role="alert">{error}</div>}
        <Field className="full" label="Name" maxLength={100} autoComplete="off" placeholder="e.g. March salary advance" value={form.name} onChange={set('name')} error={fields.name} />
        <Field as="select" label="Type" value={form.kind} options={DEDUCTION_KIND_OPTIONS} onChange={set('kind')} error={fields.kind} />
        <Field label="Amount" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set('amount')} error={fields.amount} />
        <label className="row full settings-check"><input type="checkbox" checked={form.recurring} onChange={check('recurring')} /> Monthly (unchecked: next payroll only)</label>
        <label className="row full settings-check"><input type="checkbox" checked={form.enabled} onChange={check('enabled')} /> Active for new drafts</label>
        {fields.recurring && <small className="field-error full">{fields.recurring}</small>}
      </form>
    </Modal>
  );
}
