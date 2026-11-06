import { useState } from 'react';
import { post } from '../api/client.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { AppraisalScoreFields } from './AppraisalScorePreview.jsx';
import AppraisalReviewHistory from './AppraisalReviewHistory.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';

const PAGE_SIZE = 20;
const base = '/appraisals/approvals';
const stamp = value => new Date(value).toLocaleString();

export default function AppraisalApprovals() {
  const [status, setStatus] = useState('submitted');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const list = useResource(base, { status, page, pageSize: PAGE_SIZE });
  return <div className="stack">
    <div className="row between"><h2>Appraisal approvals</h2>
      <Field as="select" hideLabel label="Approval status" value={status}
        options={[{ value: 'submitted', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved' }]}
        onChange={event => { setStatus(event.target.value); setPage(1); }} />
    </div>
    <Table caption="Appraisal approvals" rows={list.loading ? [] : list.data?.items} loading={list.loading}
      error={list.error} onRetry={list.reload} empty="No appraisals match" columns={[
        { key: 'employee', header: 'Employee' }, { key: 'cycle', header: 'Cycle' },
        { key: 'reviewer', header: 'Reviewer' }, { key: 'submittedAt', header: 'Submitted', render: row => stamp(row.submittedAt) },
        { key: 'action', header: 'Action', render: row => <Button size="sm" onClick={() => setSelected(row)}>View</Button> },
      ]} />
    <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} disabled={list.loading} />
    {selected && <ApprovalDetail key={selected.id} assignment={selected} onClose={() => setSelected(null)}
      onSaved={() => { setSelected(null); setPage(1); list.reload(); }} />}
  </div>;
}

function ApprovalDetail({ assignment, onClose, onSaved }) {
  const path = `${base}/${assignment.cycleId}/${assignment.employeeId}`;
  const data = useResource(path);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  const { review, template } = data.data ?? {};
  const canDecide = Boolean(review && !review.approvedAt && !data.loading && !data.error);
  async function decide(decision) {
    if (busy || !canDecide || (decision === 'return' && !reason.trim())) return;
    setBusy(decision);
    setError('');
    try {
      await post(path + '/decision', { version: review.version, decision, reason });
      toast.success(decision === 'approve' ? 'Appraisal approved' : 'Appraisal returned');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }
  return <Modal open wide title={`Appraisal · ${assignment.employee}`} dismissible={!busy} onClose={onClose} footer={<>
    <Button disabled={!!busy} onClick={onClose}>Close</Button>
    {canDecide && <>
      <Button disabled={!!busy || !reason.trim()} busy={busy === 'return'} onClick={() => decide('return')}>Return</Button>
      <Button variant="primary" disabled={!!busy} busy={busy === 'approve'} onClick={() => decide('approve')}>Approve</Button>
    </>}
  </>}>
    <div className="stack">
      <ResourceState loading={data.loading} error={data.error} onRetry={data.reload} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {review && <>
        <small className="muted">{data.data.cycle} · Reviewed by {data.data.reviewer} · {template.name} v{template.version}</small>
        {review.approvedAt && <p>Approved by {review.approver} · {stamp(review.approvedAt)}</p>}
        <AppraisalScoreFields categories={template.categories} inputs={review.inputs} result={review.result} disabled review />
        {review.comment && <div><strong>Overall comment</strong><p className="profile-summary">{review.comment}</p></div>}
        {canDecide && <Field as="textarea" rows={2} label="Decision note" placeholder="Required to return an appraisal"
          value={reason} maxLength={1000} disabled={!!busy} onChange={event => setReason(event.target.value)} />}
        <AppraisalReviewHistory path={path} />
      </>}
    </div>
  </Modal>;
}
