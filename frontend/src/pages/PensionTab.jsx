import { useState } from 'react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch } from '../api/client.js';
import { ResourceState, useResource } from './payrollResource.jsx';
import { PENSION_BASE_OPTIONS, buildCalcPatch, calcForm, calcChanged, validateCalcForm } from './payrollSettingsView.js';

// Pension tab (spec 12): employee and company rates and the pensionable base. Saved with PATCH, sending only what changed.
// The tax base is edited on the Income Tax tab; here it is carried along unchanged so it never ends up in the patch.
export default function PensionTab() {
  const { data, loading, error, reload } = useResource('/payroll-settings/calculation');
  if (!data) return <ResourceState loading={loading} error={error} onRetry={reload} />;
  return <PensionForm saved={data} onSaved={reload} />;
}

function PensionForm({ saved, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => calcForm(saved));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const local = validateCalcForm(form);
  const errors = { ...(attempted ? local : {}), ...serverErrors };
  const body = Object.keys(local).length ? {} : buildCalcPatch(form, saved);
  const dirty = calcChanged(form, saved);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setServerErrors({}); };

  async function save(e) {
    e.preventDefault();
    setAttempted(true);
    if (Object.keys(local).length) return;
    if (!Object.keys(body).length) { toast.info('Nothing to save'); return; }
    setBusy(true);
    try {
      const res = await patch('/payroll-settings/calculation', body);
      setForm(calcForm(res)); setAttempted(false); setServerErrors({});
      toast.success('Pension settings saved'); onSaved();
    } catch (err) {
      if (err.status === 400 && Object.keys(err.fields).length) setServerErrors(err.fields);
      else toast.error(err.message || 'Could not save. Nothing was changed.');
    } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={save} noValidate>
      <div className="pension-settings-grid">
        <Field label="Employee (%)" inputMode="decimal" value={form.employeePensionRate} onChange={set('employeePensionRate')} error={errors.employeePensionRate} />
        <Field label="Company (%)" inputMode="decimal" value={form.companyPensionRate} onChange={set('companyPensionRate')} error={errors.companyPensionRate} />
      <Field as="select" label="Pension base" value={form.pensionBase} options={PENSION_BASE_OPTIONS} onChange={set('pensionBase')} error={errors.pensionBase} />
      </div>
      <div className="row end">
        <Button size="sm" disabled={!dirty || busy} onClick={() => { setForm(calcForm(saved)); setAttempted(false); setServerErrors({}); }}>Discard</Button>
        <Button size="sm" variant="primary" type="submit" busy={busy} disabled={!dirty}>Save pension</Button>
      </div>
    </form>
  );
}
