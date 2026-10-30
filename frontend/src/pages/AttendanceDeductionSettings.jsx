import { useState } from 'react';
import Button from '../components/Button.jsx';
import { patch } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';
const keys = [['absenceDeductionEnabled', 'Deduct absence'], ['unpaidLeaveDeductionEnabled', 'Deduct approved unpaid leave']];
export default function AttendanceDeductionSettings() {
  const resource = useResource('/payroll-settings/attendance-deductions');
  if (!resource.data) return <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />;
  return <PolicyForm key={JSON.stringify(resource.data)} saved={resource.data} onSaved={resource.reload} />;
}
function PolicyForm({ saved, onSaved }) {
  const [form, setForm] = useState(saved), [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = keys.some(([k]) => form[k] !== saved[k]);
  async function save(e) {
    e.preventDefault(); if (busy || !dirty) return;
    setBusy(true);
    try { await patch('/payroll-settings/attendance-deductions', form); toast.success('Attendance deduction settings saved'); onSaved(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }
  return <form className="stack attendance-policy-settings" onSubmit={save}>
    <div className="row between"><h3>Attendance deductions</h3><div className="row"><Button size="sm" disabled={!dirty || busy} onClick={() => setForm(saved)}>Discard</Button><Button size="sm" variant="primary" type="submit" busy={busy} disabled={!dirty}>Save policy</Button></div></div>
    <div className="row">{keys.map(([key, label]) => <label className="row settings-check" key={key}><input type="checkbox" checked={form[key]} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} /> {label}</label>)}</div>
    <small className="muted">Deduction = basic salary × missed days ÷ scheduled working days.</small>
  </form>;
}
