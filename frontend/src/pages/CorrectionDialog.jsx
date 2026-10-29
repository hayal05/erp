import AuditBar from '../components/AuditBar.jsx';
import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch } from '../api/client.js';
import { STATUS_OPTIONS, buildCorrection, formFromRecord, formatWorkDate, hasChanges, validateCorrection } from './attendanceForm.js';

// HR correction of one attendance record (spec 8). A reason is required and is kept in the audit log.
// Times are wall-clock in the company time zone, exactly as the table shows them. Mount with a `key` so the form resets.
export default function CorrectionDialog({ record, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => formFromRecord(record));
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const bind = (k) => ({ value: form[k], onChange: set(k), error: fields[k] });

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validateCorrection(form);
    setFields(problems);
    setError('');
    if (Object.keys(problems).length) return;
    if (!hasChanges(form, record)) { setError('Nothing was changed. Edit the status or a time first.'); return; }

    setBusy(true);
    try {
      await patch(`/attendance-records/${record.id}`, buildCorrection(form, record));
      toast.success('Correction saved');
      onSaved();
    } catch (err) {
      if (err.status === 400) setFields(err.fields ?? {});
      setError(err.code === 'no_change' ? 'Nothing was changed.'
        : Object.keys(err.fields ?? {}).length ? 'Please fix the highlighted fields.' : err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open wide title="Correct attendance" onClose={() => !busy && onClose()}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="correction-form" busy={busy}>Save correction</Button>
      </>}>
      <form id="correction-form" className="form-grid" onSubmit={submit} noValidate>
        <p className="full muted">
          <strong>{record.fullName}</strong> ({record.employeeCode}) · {formatWorkDate(record.workDate)}. Company time. Corrections are logged.
        </p>
        {error && <div className="form-error full" role="alert">{error}</div>}
        <Field as="select" label="Status" options={STATUS_OPTIONS} {...bind('status')} />
        {form.status === 'late'
          ? <Field label="Minutes late" inputMode="numeric" maxLength={4} autoComplete="off"
            hint="Blank = calculate from shift." {...bind('lateMinutes')} />
          : <div />}
        <Field label="Check-in time" type="time" {...bind('checkInTime')} />
        <Field label="Check-out time" type="time" hint="Clear if no check-out." {...bind('checkOutTime')} />
        <Field as="textarea" className="full" label="Reason for the correction (required)" maxLength={500} rows={3} {...bind('reason')} />
      </form>
    <AuditBar type="attendance_record" id={record.id} />
    </Modal>
  );
}
