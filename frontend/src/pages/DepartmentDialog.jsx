import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch, post } from '../api/client.js';
import { EMPTY_DEPARTMENT, NAME_MAX, buildDepartment, departmentChanged, departmentForm, saveErrorView, validateDepartment } from './departmentView.js';

// Add (department = null) or rename. Mount with a `key` so the form resets each time it opens.
// Positions and salaries are managed inside the department (task 6.9), not here.
export default function DepartmentDialog({ department, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(department ? departmentForm(department) : EMPTY_DEPARTMENT);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validateDepartment(form);
    setFields(problems);
    setError('');
    if (Object.keys(problems).length) return;
    if (department && !departmentChanged(form, department)) { setError('Nothing was changed.'); return; }

    setBusy(true);
    try {
      const body = buildDepartment(form);
      const saved = department ? await patch(`/departments/${department.id}`, body) : await post('/departments', body);
      toast.success(department ? 'Department renamed' : `${saved.name} was added`);
      onSaved(saved);
    } catch (err) {
      const v = saveErrorView(err);
      setFields(v.fields);
      setError(v.message || 'Please fix the highlighted field.');
      setBusy(false);
    }
  }

  return (
    <Modal open title={department ? 'Rename department' : 'Add department'} onClose={() => !busy && onClose()}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="department-form" busy={busy}>{department ? 'Save' : 'Add department'}</Button>
      </>}>
      <form id="department-form" className="stack" onSubmit={submit} noValidate>
        {error && <div className="form-error" role="alert">{error}</div>}
        <Field label="Name" maxLength={NAME_MAX} autoComplete="off" value={form.name} error={fields.name}
          onChange={(e) => { setForm({ name: e.target.value }); setFields({}); }} />
        {!department && <p className="muted">After adding the department, open it to set up its positions and their salaries.</p>}
      </form>
    </Modal>
  );
}
