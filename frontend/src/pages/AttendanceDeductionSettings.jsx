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
  return <form className="stack" onSubmit={save}>
    <h3>Attendance deductions</h3>
    <p className="muted">Deduction = basic salary × missed days ÷ scheduled working days.</p>
    {keys.map(([key, label]) => <label key={key}><input type="checkbox" checked={form[key]} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} /> {label}</label>)}
    <p className="muted">Recalculate drafts to apply changes. Approved payroll stays unchanged.</p>
    <div className="row end"><Button disabled={!dirty || busy} onClick={() => setForm(saved)}>Discard changes</Button><Button variant="primary" type="submit" busy={busy} disabled={!dirty}>Save attendance settings</Button></div>
  </form>;
}
