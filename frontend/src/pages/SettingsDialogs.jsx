import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch, post } from '../api/client.js';
import { EMPTY_HOLIDAY, EMPTY_SHIFT, WEEKDAYS, buildHoliday, buildShift, holidayChanged, holidayForm, saveErrorView, shiftChanged, shiftForm, toggleDay, validateHoliday, validateShift } from './settingsView.js';

// Shared save flow for both dialogs: validate, refuse a no-op edit, send, map server errors. Mount with a `key` so the form resets.
function useSave({ initial, validate, changed, send, done, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setFields((x) => ({ ...x, [k]: undefined })); };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validate(form);
    setFields(problems); setError('');
    if (Object.keys(problems).length) return;
    if (!changed(form)) { setError('Nothing was changed.'); return; }
    setBusy(true);
    try { const saved = await send(form); toast.success(done); onSaved(saved); }
    catch (err) { const v = saveErrorView(err); setFields(v.fields); setError(v.message || 'Please fix the highlighted fields.'); setBusy(false); }
  }
  return { form, setForm, set, fields, setFields, error, busy, submit };
}

// Add or edit one company holiday. Moving or deleting a holiday never changes leave requests that already exist.
export function HolidayDialog({ holiday, year, onClose, onSaved }) {
  const s = useSave({
    initial: holiday ? holidayForm(holiday) : { ...EMPTY_HOLIDAY, date: `${year}-01-01` }, validate: validateHoliday,
    changed: (f) => !holiday || holidayChanged(f, holiday),
    send: (f) => (holiday ? patch(`/settings/holidays/${holiday.id}`, buildHoliday(f)) : post('/settings/holidays', buildHoliday(f))),
    done: holiday ? 'Holiday updated' : 'Holiday added', onSaved,
  });
  return (
    <Modal open title={holiday ? 'Edit holiday' : 'Add holiday'} onClose={() => !s.busy && onClose()}
      footer={<><Button onClick={onClose} disabled={s.busy}>Cancel</Button><Button variant="primary" type="submit" form="holiday-form" busy={s.busy}>Save</Button></>}>
      <form id="holiday-form" className="stack" onSubmit={s.submit} noValidate>
        {s.error && <div className="form-error" role="alert">{s.error}</div>}
        <Field label="Date" type="date" value={s.form.date} onChange={s.set('date')} error={s.fields.date} />
        <Field label="Name" maxLength={100} autoComplete="off" value={s.form.name} onChange={s.set('name')} error={s.fields.name} />
        <p className="muted">Holidays are excluded from new leave requests.</p>
      </form>
    </Modal>
  );
}

// Add or edit a working schedule: its hours, late grace and the weekdays people work. Leave day counts use the work days.
export function ShiftDialog({ shift, onClose, onSaved }) {
  const s = useSave({
    initial: shift ? shiftForm(shift) : EMPTY_SHIFT, validate: validateShift, changed: (f) => !shift || shiftChanged(f, shift),
    send: (f) => (shift ? patch(`/shifts/${shift.id}`, buildShift(f)) : post('/shifts', buildShift(f))),
    done: shift ? 'Schedule updated' : 'Schedule added', onSaved,
  });
  const toggle = (day) => { s.setForm((f) => ({ ...f, workDays: toggleDay(f.workDays, day) })); s.setFields((x) => ({ ...x, workDays: undefined })); };
  return (
    <Modal open wide title={shift ? 'Edit schedule' : 'Add schedule'} onClose={() => !s.busy && onClose()}
      footer={<><Button onClick={onClose} disabled={s.busy}>Cancel</Button><Button variant="primary" type="submit" form="shift-form" busy={s.busy}>Save</Button></>}>
      <form id="shift-form" className="form-grid" onSubmit={s.submit} noValidate>
        {s.error && <div className="form-error full" role="alert">{s.error}</div>}
        <Field className="full" label="Name" maxLength={100} autoComplete="off" value={s.form.name} onChange={s.set('name')} error={s.fields.name} />
        <Field label="Start time" type="time" value={s.form.startTime} onChange={s.set('startTime')} error={s.fields.startTime} />
        <Field label="End time" type="time" value={s.form.endTime} onChange={s.set('endTime')} error={s.fields.endTime} />
        <Field label="Grace period (minutes)" inputMode="numeric" maxLength={3} autoComplete="off" value={s.form.graceMinutes} onChange={s.set('graceMinutes')}
          error={s.fields.graceMinutes} hint="Allowed minutes after shift start." />
        <fieldset className="full weekdays" aria-describedby={s.fields.workDays ? 'weekdays-err' : undefined}>
          <legend>Work days</legend>
          {WEEKDAYS.map(([n, label]) => (
            <label key={n}><input type="checkbox" checked={s.form.workDays.includes(n)} onChange={() => toggle(n)} /> {label}</label>
          ))}
          {s.fields.workDays && <small id="weekdays-err" className="field-error">{s.fields.workDays}</small>}
        </fieldset>
        <p className="full muted">Select working days. Overnight shifts are not supported.</p>
      </form>
    </Modal>
  );
}
