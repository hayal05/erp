import {usePageRefresh} from '../api/pageRefresh.jsx';
import Skeleton from '../components/Skeleton.jsx';
import {usePermission} from '../api/auth.jsx';
import { useEffect, useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { get, put } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { profileForm, profilePayload } from './salaryProfileForm.js';
export default function SalaryProfileDialog({ employee, onClose }) {
  const pageRefresh = usePageRefresh();
  const canManage=usePermission('salary_profiles.manage');
  const toast = useToast();
  const [form, setForm] = useState(null), [error, setError] = useState(''), [fields, setFields] = useState({}), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setError('');
    get(`/salary-profiles/${employee.id}`, {}, { signal: ctrl.signal }).then((p) => setForm(profileForm(p))).catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctrl.abort();
  }, [employee.id, retry, pageRefresh]);
  async function submit(e) {
    e.preventDefault();
    if (!canManage || busy || !form) return;
    const result = profilePayload(form); setFields(result.errors ?? {}); setError('');
    if (result.errors) return;
    setBusy(true);
    try { await put(`/salary-profiles/${employee.id}`, result.value); toast.success('Salary profile saved'); onClose(); }
    catch (e) { const f = e.fields ?? {}; setFields({ ...f, basic: f.basicMinor, allowance: f.allowanceMinor }); setError(e.message); }
    finally { setBusy(false); }
  }
  return <Modal open title={`Salary — ${employee.fullName}`} onClose={() => !busy && onClose()} footer={<>
    <Button onClick={onClose} disabled={busy}>{canManage?'Cancel':'Close'}</Button>{canManage && <Button variant="primary" type="submit" form="salary-profile" busy={busy} disabled={!form}>Save salary</Button>}
  </>}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!form ? error ? <Button onClick={() => setRetry((n) => n + 1)}>Retry</Button> : <Skeleton label="Loading salary…" /> :
      <form id="salary-profile" className="stack salary-profile-form" onSubmit={submit} noValidate>
        <div className="form-grid">{['basic', 'allowance'].map((key) => <Field key={key} label={key === 'basic' ? 'Basic salary' : 'Allowance'} inputMode="decimal" value={form[key]} error={fields[key]} disabled={busy||!canManage} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />)}</div>
        <fieldset className="salary-profile-flags"><legend>Tax &amp; pension</legend>{[['allowanceTaxable', 'Taxable allowance'], ['allowancePensionable', 'Pensionable allowance'], ['pensionApplies', 'Employee pension']].map(([key, label]) =>
          <label key={key}><input type="checkbox" checked={form[key]} disabled={busy||!canManage} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} /> {label}</label>)}</fieldset>
        <small className="muted">Allowance flags require matching payroll base settings.</small>
      </form>}
    </Modal>;
}
