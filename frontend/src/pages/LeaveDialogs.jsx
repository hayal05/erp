import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { post } from '../api/client.js';
import { EMPTY_CHANGE, buildBalanceChange, buildDecision, hrLeaveErrorView, previewTotal, validateBalanceChange, validateDecision } from './leaveAdminView.js';

// Approve or reject one pending request (spec 10). Rejecting needs a reason the employee will see; approving may add a note.
// Mount with a `key` so the form resets. `onDone(stale)` refreshes the list; stale = someone else already decided it.
export function DecisionDialog({ request, decision, onClose, onDone }) {
  const toast = useToast();
  const approving = decision === 'approve';
  const [remarks, setRemarks] = useState('');
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validateDecision(decision, remarks);
    setFields(problems); setError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await post(`/leave-admin/requests/${request.id}/${decision}`, buildDecision(remarks));
      toast.success(approving ? 'Leave approved' : 'Leave rejected');
      onDone();
    } catch (err) {
      const view = hrLeaveErrorView(err);
      if (view.stale) { toast.error(view.message); onDone(); return; }
      setFields(view.fields); setError(view.message || 'Please fix the highlighted field.'); setBusy(false);
    }
  }

  return (
    <Modal open title={approving ? 'Approve leave' : 'Reject leave'} onClose={() => !busy && onClose()}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={approving ? 'primary' : 'danger'} type="submit" form="leave-decision-form" busy={busy}>{approving ? 'Approve' : 'Reject'}</Button>
      </>}>
      <form id="leave-decision-form" className="stack" onSubmit={submit} noValidate>
        <div className="leave-request-summary"><div className="leave-person"><strong>{request.employee}</strong><small className="muted">{request.code}</small></div><div className="leave-request-meta"><span>{request.type}</span><span>{request.dates}</span><strong>{request.days} {request.days === 1 ? 'day' : 'days'}</strong></div></div>
        {request.reason && <p className="leave-request-reason"><span className="muted">Reason: </span>{request.reason}</p>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <Field as="textarea" rows={3} maxLength={500} label={approving ? 'Note (optional)' : 'Rejection reason'} required={!approving}
          value={remarks} onChange={(e) => { setRemarks(e.target.value); setFields({}); }} error={fields.remarks}
          hint="Visible to the employee." />
      </form>
    </Modal>
  );
}

// Change one employee's yearly entitlement for one leave type. The reason is required and goes to the audit log.
export function EntitlementDialog({ employee, balance, year, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_CHANGE);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setFields((x) => ({ ...x, [k]: undefined })); };
  const preview = previewTotal(balance, form);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validateBalanceChange(form);
    setFields(problems); setError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await post('/leave-admin/balances', buildBalanceChange(form, { employeeId: employee.id, leaveTypeId: balance.leaveTypeId, year }));
      toast.success('Balance updated');
      onSaved();
    } catch (err) {
      const view = hrLeaveErrorView(err);
      setFields(view.fields); setError(view.message || 'Please fix the highlighted fields.'); setBusy(false);
    }
  }

  return (
    <Modal open title="Change leave balance" onClose={() => !busy && onClose()}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="leave-balance-form" busy={busy}>Save change</Button>
      </>}>
      <form id="leave-balance-form" className="stack" onSubmit={submit} noValidate>
        <div className="leave-request-summary"><div className="leave-person"><strong>{employee.fullName}</strong><small className="muted">{employee.employeeCode}</small></div><span className="muted">{balance.name} · {year}</span></div>
        <dl className="leave-balance-summary">{[['Entitlement',balance.entitled],['Adjustment',balance.adjusted],['Used',balance.used],['Pending',balance.pending]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-grid">
          <Field label="Yearly entitlement" inputMode="numeric" maxLength={3} autoComplete="off" value={form.entitledDays} onChange={set('entitledDays')}
            error={fields.entitledDays} hint="Blank: keep current." />
          <Field label="Adjust days" inputMode="numeric" maxLength={4} autoComplete="off" value={form.adjustDays} onChange={set('adjustDays')}
            error={fields.adjustDays} placeholder="e.g. 2 or -1" />
        </div>
        {preview && <p className="muted" aria-live="polite">After change: {preview.text}.</p>}
        <Field as="textarea" rows={3} maxLength={500} label="Reason" required value={form.reason} onChange={set('reason')} error={fields.reason} />
      </form>
    </Modal>
  );
}
