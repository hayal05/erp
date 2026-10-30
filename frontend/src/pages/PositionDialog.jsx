import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch, post } from '../api/client.js';
import { saveErrorView } from './departmentView.js';
import { EMPTY_POSITION, POSITION_NAME_MAX, buildPosition, monthlyTotal, positionChanged, positionForm, positionServerFields, validatePosition } from './positionForm.js';

// Add (position = null) or edit one position of a department. Mount with a `key` so the form resets each time it opens.
export default function PositionDialog({ departmentId, position, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(position ? positionForm(position) : EMPTY_POSITION);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setFields((x) => ({ ...x, [k]: undefined })); };
  const check = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.checked })); };
  const total = monthlyTotal(form);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validatePosition(form);
    setFields(problems);
    setError('');
    if (Object.keys(problems).length) return;
    if (position && !positionChanged(form, position)) { setError('Nothing was changed.'); return; }
    setBusy(true);
    try {
      const body = buildPosition(form);
      const saved = position ? await patch(`/positions/${position.id}`, body) : await post(`/departments/${departmentId}/positions`, body);
      toast.success(position ? 'Position saved' : `${saved.name} was added`);
      onSaved(saved);
    } catch (err) {
      const v = saveErrorView(err);
      setFields(positionServerFields(v.fields));
      setError(v.message || 'Please fix the highlighted fields.');
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={position ? 'Edit position' : 'Add position'} onClose={() => !busy && onClose()}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="position-form" busy={busy}>{position ? 'Save' : 'Add position'}</Button>
      </>}>
      <form id="position-form" className="form-grid" onSubmit={submit} noValidate>
        {error && <div className="form-error full" role="alert">{error}</div>}
        <Field className="full" label="Position name" maxLength={POSITION_NAME_MAX} autoComplete="off" value={form.name} error={fields.name} onChange={set('name')} />
        <Field label="Basic salary (monthly)" inputMode="decimal" autoComplete="off" value={form.basic} error={fields.basic} onChange={set('basic')} />
        <Field label="Allowance (monthly)" inputMode="decimal" autoComplete="off" value={form.allowance} error={fields.allowance} onChange={set('allowance')} />
        <div className="stack full">
          <label><input type="checkbox" checked={form.allowanceTaxable} onChange={check('allowanceTaxable')} /> Allowance is taxable</label>
          <label><input type="checkbox" checked={form.allowancePensionable} onChange={check('allowancePensionable')} /> Allowance is pensionable</label>
          <label><input type="checkbox" checked={form.pensionApplies} onChange={check('pensionApplies')} /> Pension applies to employees in this position</label>
          <small className="muted">Allowance flags require matching payroll base settings.</small>
          {total && <p aria-live="polite">Basic plus allowance: <strong>{total}</strong></p>}
          <p className="muted">Existing salaries stay unchanged. Renaming updates job titles.</p>
        </div>
      </form>
    </Modal>
  );
}
