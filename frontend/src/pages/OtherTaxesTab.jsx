import { useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Badge } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { del, patch, post } from '../api/client.js';
import { useResource } from './payrollResource.jsx';
import { saveErrorView } from './settingsView.js';
import { EMPTY_OTHER_TAX, baseOptions, buildOtherTaxCreate, buildOtherTaxPatch, otherTaxForm, otherTaxLine, validateOtherTax } from './payrollSettingsView.js';

// Other Taxes tab (spec 14): extra percentage taxes taken from pay, each on one of the server's fixed bases.
// Pausing keeps the tax but stops it applying to new drafts; deleting never changes approved payroll (entries keep their own copies).
export default function OtherTaxesTab() {
  const toast = useToast();
  const { data, loading, error, reload } = useResource('/payroll-settings/other-taxes');
  const [dialog, setDialog] = useState(null);   // null | { tax: null | {…} }
  const [removing, setRemoving] = useState(null); // null | { tax, busy }
  const [toggling, setToggling] = useState(null); // id being paused/resumed

  async function toggle(t) {
    setToggling(t.id);
    try { await patch(`/payroll-settings/other-taxes/${t.id}`, { enabled: !t.enabled }); toast.success(t.enabled ? `${t.name} paused` : `${t.name} resumed`); }
    catch (err) { toast.error(saveErrorView(err).message || err.message); }
    finally { setToggling(null); reload(); }
  }
  async function remove() {
    setRemoving((r) => ({ ...r, busy: true }));
    try { await del(`/payroll-settings/other-taxes/${removing.tax.id}`); toast.success('Tax deleted'); }
    catch (err) { toast.error(saveErrorView(err).message || err.message); }
    finally { setRemoving(null); reload(); }
  }

  const columns = [
    { key: 'name', header: 'Tax', render: (t) => <strong>{t.name}</strong> },
    { key: 'calc', header: 'Calculation', render: otherTaxLine },
    { key: 'state', header: 'Status', render: (t) => <Badge tone={t.enabled ? 'ok' : 'neutral'}>{t.enabled ? 'Active' : 'Paused'}</Badge> },
    { key: 'act', header: <span className="sr-only">Actions</span>, className: 'nowrap', render: (t) => (
      <span className="row">
        <Button size="sm" busy={toggling === t.id} onClick={() => toggle(t)} aria-label={`${t.enabled ? 'Pause' : 'Resume'} ${t.name}`}>{t.enabled ? 'Pause' : 'Resume'}</Button>
        <Button size="sm" onClick={() => setDialog({ tax: t })} aria-label={`Edit ${t.name}`}>Edit</Button>
        <Button size="sm" onClick={() => setRemoving({ tax: t, busy: false })} aria-label={`Delete ${t.name}`}>Delete</Button>
      </span>
    ) },
  ];

  return (
    <div className="stack">
      <div className="row between">
        <h2>Other taxes</h2>
        <Button variant="primary" disabled={!data} onClick={() => setDialog({ tax: null })}><Plus size={16} aria-hidden="true" /> Add tax</Button>
      </div>
      <Table caption="Other taxes" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload} empty="No other taxes set up" />
      <p className="muted">Changes apply to drafts generated from now on. Approved payroll keeps the values it was approved with.</p>

      {dialog && data && <OtherTaxDialog key={dialog.tax?.id ?? 'new'} tax={dialog.tax} bases={data.bases} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload(); }} />}
      <Modal open={!!removing} title="Delete this tax?" onClose={() => !removing?.busy && setRemoving(null)}
        footer={<><Button onClick={() => setRemoving(null)} disabled={removing?.busy}>Keep it</Button><Button variant="danger" busy={removing?.busy} onClick={remove}>Delete tax</Button></>}>
        <p>{removing?.tax.name} will no longer be taken in new payroll drafts. Approved and paid payroll is not changed. To stop it temporarily, use Pause instead.</p>
      </Modal>
    </div>
  );
}

function OtherTaxDialog({ tax, bases, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => (tax ? otherTaxForm(tax) : EMPTY_OTHER_TAX));
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setFields((x) => ({ ...x, [k]: undefined })); };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validateOtherTax(form, bases);
    setFields(problems); setError('');
    if (Object.keys(problems).length) return;
    const body = tax ? buildOtherTaxPatch(form, tax) : buildOtherTaxCreate(form);
    if (tax && !Object.keys(body).length) { setError('Nothing was changed.'); return; }
    setBusy(true);
    try {
      if (tax) await patch(`/payroll-settings/other-taxes/${tax.id}`, body); else await post('/payroll-settings/other-taxes', body);
      toast.success(tax ? 'Tax updated' : 'Tax added'); onSaved();
    } catch (err) {
      const v = saveErrorView(err);
      setFields(v.fields); setError(v.message || 'Please fix the highlighted fields.'); setBusy(false);
    }
  }

  return (
    <Modal open title={tax ? 'Edit tax' : 'Add tax'} onClose={() => !busy && onClose()}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="other-tax-form" busy={busy}>Save</Button></>}>
      <form id="other-tax-form" className="stack" onSubmit={submit} noValidate>
        {error && <div className="form-error" role="alert">{error}</div>}
        <Field label="Name" maxLength={100} autoComplete="off" value={form.name} onChange={set('name')} error={fields.name} />
        <Field label="Rate (%)" inputMode="decimal" value={form.rate} onChange={set('rate')} error={fields.rate} />
        <Field as="select" label="Calculated on" value={form.base} options={baseOptions(bases)} placeholder="Choose…" onChange={set('base')} error={fields.base} />
        <label className="row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} /> Active (applies to new payroll drafts)</label>
      </form>
    </Modal>
  );
}
