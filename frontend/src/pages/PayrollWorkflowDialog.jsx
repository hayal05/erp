import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { post } from '../api/client.js';
import { localDate, paymentDateError } from './payrollWorkflowView.js';
const titles = { generate: 'Generate draft', regenerate: 'Regenerate payroll', approve: 'Approve payroll', pay: 'Mark paid' };
export default function PayrollWorkflowDialog({ action, month, period, total, onClose, onSaved, onReload }) {
  const [paidOn, setPaidOn] = useState(localDate), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dateError, setDateError] = useState('');
  const [conflict, setConflict] = useState(false);
  async function submit(e) {
    e.preventDefault(); if (busy || conflict) return;
    const problem = action === 'pay' ? paymentDateError(paidOn) : '';
    setDateError(problem); setError(''); if (problem) return;
    setBusy(true);
    try {
      const path = action === 'generate' ? '/payroll/periods' : `/payroll/periods/${period.id}/${action === 'regenerate' ? 'regenerate' : action === 'approve' ? 'approve' : 'pay'}`;
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
      {action === 'generate' && <p>Generate payroll for all active employees?</p>}
      {action === 'regenerate' && <p>Rebuild this draft from active employees, salary profiles, taxes, pension, deductions and attendance? Manual salary edits will be replaced; one-time deductions are reapplied once. Review before approval.</p>}
      {action === 'approve' && <p>Approve {total} entries? Salary amounts and deductions will be locked.</p>}
      {action === 'pay' && <><p>Mark this payroll paid? This records payment; no money is transferred.</p><Field label="Payment date" type="date" min="1000-01-01" max="9999-12-31" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} disabled={busy} error={dateError} /></>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Modal>;
}
