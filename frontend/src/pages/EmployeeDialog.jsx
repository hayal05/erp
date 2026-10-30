import {usePermission} from '../api/auth.jsx';
import AuditBar from '../components/AuditBar.jsx';
import { useEffect, useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { get, patch, post } from '../api/client.js';
import { EMPLOYMENT_TYPES, MIN_PASSWORD, buildCreate, buildPatch, changeDepartment, emptyForm, employeeSaveError, formFromEmployee, needsCurrentSalary, positionOptions, salaryPlan, savedMessage, validateForm } from './employeeForm.js';
import PositionSalaryPreview from './PositionSalaryPreview.jsx';

const POSITION_LIMIT = 100; // the API caps pageSize at 100

// Add (employee = null) or edit. Mount with a `key` so the form resets each time it opens.
export default function EmployeeDialog({ employee, departments, shifts, onClose, onSaved }) {
  const canManage=usePermission('employees.manage');
  const readOnly=!canManage;
  const mode = employee ? 'edit' : 'create';
  const toast = useToast();
  const [form, setForm] = useState(() => (employee ? formFromEmployee(employee) : { ...emptyForm(), shiftId: shifts[0] ? String(shifts[0].id) : '' }));
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [positions, setPositions] = useState({ status: 'idle', items: [], total: 0, error: '' }); // of the chosen department
  const [profile, setProfile] = useState({ status: 'idle', value: null, error: '' });             // current salary of the employee
  const [retry, setRetry] = useState({ positions: 0, profile: 0 });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const bind = (k) => ({ value: form[k], onChange: set(k), error: fields[k] });

  // The position list follows the chosen department; no department, no list.
  useEffect(() => {
    if (!form.departmentId) { setPositions({ status: 'idle', items: [], total: 0, error: '' }); return undefined; }
    const ctrl = new AbortController();
    setPositions((p) => ({ ...p, status: 'loading', error: '' }));
    get(`/departments/${form.departmentId}/positions`, { pageSize: POSITION_LIMIT }, { signal: ctrl.signal })
      .then((res) => setPositions({ status: 'ready', items: res.items, total: res.total, error: '' }))
      .catch((e) => { if (e.name !== 'AbortError') setPositions({ status: 'error', items: [], total: 0, error: e.message }); });
    return () => ctrl.abort();
  }, [form.departmentId, retry.positions]);

  // The current salary is only needed to compare it with a newly chosen position.
  const wantProfile = needsCurrentSalary(form, employee);
  useEffect(() => {
    if (!wantProfile) return undefined;
    const ctrl = new AbortController();
    setProfile({ status: 'loading', value: null, error: '' });
    get(`/salary-profiles/${employee.id}`, {}, { signal: ctrl.signal })
      .then((value) => setProfile({ status: 'ready', value, error: '' }))
      .catch((e) => { if (e.name !== 'AbortError') setProfile({ status: 'error', value: null, error: e.message }); });
    return () => ctrl.abort();
  }, [wantProfile, employee?.id, retry.profile]);

  const plan = salaryPlan({ form, original: employee, positions: positions.items, profile: profile.status === 'ready' ? profile.value : null });
  const departmentChosen = Boolean(form.departmentId);
  const positionHint = !departmentChosen ? 'Choose a department first.'
    : positions.status === 'error' ? `Could not load positions: ${positions.error}`
    : positions.status === 'ready' && positions.total === 0 ? 'Add positions under Departments.'
    : positions.total > POSITION_LIMIT ? `Showing the first ${POSITION_LIMIT} of ${positions.total} positions.`
    : 'Position sets the title and salary.';

  async function submit(e) {
    e.preventDefault();
    if (busy || readOnly) return;
    const problems = validateForm(form, mode, employee);
    setFields(problems);
    setError('');
    if (Object.keys(problems).length) return;

    setBusy(true);
    try {
      if (mode === 'create') {
        const body = buildCreate(form);
        const saved = await post('/employees', body);
        toast.success(savedMessage('create', body, saved));
      } else {
        const changes = buildPatch(form, employee);
        if (Object.keys(changes).length) await patch(`/employees/${employee.id}`, changes);
        toast.success(savedMessage('edit', changes, employee));
      }
      onSaved();
    } catch (err) {
      const v = employeeSaveError(err);
      setFields(v.fields);
      setError(v.message);
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={readOnly?'Employee details':mode === 'create' ? 'Add employee' : 'Edit employee'} onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={busy}>{readOnly?'Close':'Cancel'}</Button>
        {!readOnly && <Button variant="primary" type="submit" form="employee-form" busy={busy}>{mode === 'create' ? 'Add employee' : 'Save changes'}</Button>}
      </>}>
      <form id="employee-form" onSubmit={submit} noValidate><fieldset disabled={readOnly} className="form-grid" style={{border:0,padding:0,margin:0,minWidth:0}}> 
        {error && <div className="form-error full" role="alert">{error}</div>}
        <Field label="Employee ID" maxLength={40} autoComplete="off" {...bind('employeeCode')} />
        <Field label="Full name" maxLength={120} autoComplete="off" {...bind('fullName')} />
        <Field label="Username (used to sign in)" required minLength={3} maxLength={254} autoComplete="off" autoCapitalize="none" {...bind('username')} />
        <Field label="Email (optional contact)" type="email" maxLength={254} autoComplete="off" inputMode="email" autoCapitalize="none" {...bind('email')} />
        <Field label="Phone" type="tel" maxLength={30} autoComplete="off" {...bind('phone')} />
        <Field as="select" label="Department" placeholder="No department" options={departments.map((d) => ({ value: d.id, label: d.name }))}
          value={form.departmentId} error={fields.departmentId} onChange={(e) => { setForm((f) => changeDepartment(f, e.target.value, employee)); setFields((x) => ({ ...x, departmentId: undefined, positionId: undefined })); }} />
        <Field as="select" label="Position" placeholder="No position" options={positionOptions(positions.items)} disabled={!departmentChosen || busy}
          hint={positionHint} value={form.positionId} error={fields.positionId}
          onChange={(e) => { setForm((f) => ({ ...f, positionId: e.target.value, applyPositionSalary: true })); setFields((x) => ({ ...x, positionId: undefined })); }} />
        {form.positionId === '' && employee?.jobTitle && (
          <Field className="full" label="Current job title" value={employee.jobTitle} readOnly
            hint="Replaced when a position is selected." />
        )}
        <PositionSalaryPreview plan={plan} profile={profile} busy={busy}
          onApplyChange={(apply) => setForm((f) => ({ ...f, applyPositionSalary: apply }))}
          onRetry={() => setRetry((r) => ({ ...r, profile: r.profile + 1 }))} />
        <Field label="Start date" type="date" {...bind('startDate')} />
        <Field as="select" label="Employment type" options={EMPLOYMENT_TYPES} {...bind('employmentType')} />
        <Field as="select" label="Schedule (shift)" options={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }))} {...bind('shiftId')} />
        {mode === 'create' && (
          <Field label="Temporary password" type="password" autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters. Change required at first sign-in.`} {...bind('password')} />
        )}
      </fieldset></form>
    <AuditBar type="employee" id={employee?.id} />
    </Modal>
  );
}
