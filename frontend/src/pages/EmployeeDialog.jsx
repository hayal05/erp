import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch, post } from '../api/client.js';
import { EMPLOYMENT_TYPES, MIN_PASSWORD, buildCreate, buildPatch, emptyForm, formFromEmployee, validateForm } from './employeeForm.js';

// Add (employee = null) or edit. Mount with a `key` so the form resets each time it opens.
export default function EmployeeDialog({ employee, departments, shifts, onClose, onSaved }) {
  const mode = employee ? 'edit' : 'create';
  const toast = useToast();
  const [form, setForm] = useState(() => (employee ? formFromEmployee(employee) : { ...emptyForm(), shiftId: shifts[0] ? String(shifts[0].id) : '' }));
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const bind = (k) => ({ value: form[k], onChange: set(k), error: fields[k] });

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validateForm(form, mode);
    setFields(problems);
    setError('');
    if (Object.keys(problems).length) return;

    setBusy(true);
    try {
      if (mode === 'create') {
        const saved = await post('/employees', buildCreate(form));
        toast.success(`${saved.fullName} was added`);
      } else {
        const changes = buildPatch(form, employee);
        if (Object.keys(changes).length) await patch(`/employees/${employee.id}`, changes);
        toast.success('Changes saved');
      }
      onSaved();
    } catch (err) {
      if (err.status === 400 || err.status === 409) setFields(err.fields);
      setError(err.fields?._ ?? (Object.keys(err.fields ?? {}).length ? 'Please fix the highlighted fields.' : err.message));
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={mode === 'create' ? 'Add employee' : 'Edit employee'} onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="employee-form" busy={busy}>{mode === 'create' ? 'Add employee' : 'Save changes'}</Button>
      </>}>
      <form id="employee-form" className="form-grid" onSubmit={submit} noValidate>
        {error && <div className="form-error full" role="alert">{error}</div>}
        <Field label="Employee ID" maxLength={40} autoComplete="off" {...bind('employeeCode')} />
        <Field label="Full name" maxLength={120} autoComplete="off" {...bind('fullName')} />
        <Field label="Email (used to sign in)" type="email" maxLength={254} autoComplete="off" inputMode="email" autoCapitalize="none" {...bind('email')} />
        <Field label="Phone" type="tel" maxLength={30} autoComplete="off" {...bind('phone')} />
        <Field as="select" label="Department" placeholder="No department" options={departments.map((d) => ({ value: d.id, label: d.name }))} {...bind('departmentId')} />
        <Field label="Job title" maxLength={100} autoComplete="off" {...bind('jobTitle')} />
        <Field label="Start date" type="date" {...bind('startDate')} />
        <Field as="select" label="Employment type" options={EMPLOYMENT_TYPES} {...bind('employmentType')} />
        <Field as="select" label="Schedule (shift)" options={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }))} {...bind('shiftId')} />
        {mode === 'create' && (
          <Field label="Initial password" type="password" autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters. Share it with the employee privately.`} {...bind('password')} />
        )}
      </form>
    </Modal>
  );
}
