import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { post } from '../api/client.js';
import { localDate, paymentDateError } from './payrollWorkflowView.js';
const titles = { generate: 'Generate draft', approve: 'Approve payroll', pay: 'Mark paid' };
export default function PayrollWorkflowDialog({ action, month, period, total, onClose, onSaved, onReload }) {
  const [paidOn, setPaidOn] = useState(localDate), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dateError, setDateError] = useState('');
  const [conflict, setConflict] = useState(false);
  async function submit(e) {
    e.preventDefault(); if (busy || conflict) return;
    const problem = action === 'pay' ? paymentDateError(paidOn) : '';
    setDateError(problem); setError(''); if (problem) return;
    setBusy(true);
    try {
      const path = action === 'generate' ? '/payroll/periods' : `/payroll/periods/${period.id}/${action === 'approve' ? 'approve' : 'pay'}`;
      const body = action === 'generate' ? { month } : action === 'pay' ? { paidOn } : {};
      onSaved(await post(path, body));
    } catch (e) {
      let message = e.message;
      if (e.details?.employeeIds?.length) message += ` (Employee IDs: ${e.details.employeeIds.join(', ')})`;
      if (e.details?.entryId) message += ` (Entry ${e.details.entryId})`;
      setError(message);
      if (e.fields?.paidOn) setDateError(e.fields.paidOn);
      setConflict(e.status === 409 || e.status === 404);
    } finally { setBusy(false); }
  }
  return <Modal open title={`${titles[action]} · ${month}`} onClose={() => !busy && onClose()} footer={<>
    <Button disabled={busy} onClick={onClose}>Cancel</Button>
    {conflict ? <Button variant="primary" onClick={onReload}>Reload payroll</Button> : <Button variant="primary" type="submit" form="payroll-workflow" busy={busy}>{titles[action]}</Button>}
  </>}>
    <form id="payroll-workflow" className="stack" onSubmit={submit} noValidate>
      {action === 'generate' && <p>Create a draft for all active employees using their saved salary profiles and current payroll settings. Review the amounts before approval.</p>}
      {action === 'approve' && <p>Approve all {total} employee entries in this payroll. Approval saves a snapshot and locks salary amounts and deductions. Review the entire salary sheet before approving.</p>}
      {action === 'pay' && <><p>Record that this approved payroll has been paid outside the app. This records the date and your user account; it does not transfer money.</p><Field label="Payment date" type="date" min="1000-01-01" max="9999-12-31" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} disabled={busy} error={dateError} /></>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Modal>;
}
