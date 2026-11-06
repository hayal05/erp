import { useState } from 'react';
import { previewAppraisal } from '../../../shared/appraisalPreview.mjs';
import { post, put } from '../api/client.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { AppraisalScoreFields } from './AppraisalScorePreview.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';

export default function AppraisalReview({ assignment, onClose, onChanged }) {
  const path = `/appraisals/reviews/${assignment.cycleId}/${assignment.employeeId}`;
  const resource = useResource(path);
  if (resource.data?.template) {
    return <ReviewEditor assignment={resource.data} path={path} onClose={onClose} onChanged={onChanged} />;
  }
  return <Modal open title="Appraisal review" onClose={onClose}>
    <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
  </Modal>;
}

function ReviewEditor({ assignment, path, onClose, onChanged }) {
  const { template, cycle, dueOn, employee } = assignment;
  const [review, setReview] = useState(assignment.review);
  const [inputs, setInputs] = useState(review.inputs);
  const [comment, setComment] = useState(review.comment);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  const submitted = Boolean(review.submittedAt);
  const result = review.result ?? previewAppraisal(template.categories, template.brackets, inputs);
  const invalid = result.categories.some(group => group.criteria.some(row => row.result.status === 'invalid'));

  function change(id, value) {
    setInputs(current => ({ ...current, [id]: { ...current[id], ...value } }));
  }

  async function save(action) {
    if (busy || submitted || invalid || (action === 'submit' && result.status !== 'scored')) return;
    setBusy(action);
    setError('');
    try {
      const body = { version: review.version, inputs, comment };
      const saved = action === 'submit' ? await post(path + '/submit', body) : await put(path, body);
      setReview(saved);
      setInputs(saved.inputs);
      setComment(saved.comment);
      onChanged();
      toast.success(action === 'submit' ? 'Appraisal submitted' : 'Draft saved');
    } catch (err) {
      setError(err.fields?.inputs ?? err.message);
    } finally {
      setBusy('');
    }
  }

  return <Modal open wide title={`Appraisal · ${employee}`} dismissible={!busy} onClose={() => !busy && onClose()}
    footer={<>
      <Button disabled={!!busy} onClick={onClose}>Close</Button>
      {!submitted && <>
        <Button disabled={!!busy || invalid} busy={busy === 'save'} onClick={() => save('save')}>Save draft</Button>
        <Button variant="primary" disabled={!!busy || result.status !== 'scored'} busy={busy === 'submit'}
          onClick={() => save('submit')}>Submit appraisal</Button>
      </>}
    </>}>
    <div className="stack">
      <small className="muted">{cycle} · Deadline {dueOn} · {template.name} v{template.version}</small>
      {submitted && <p role="status">Submitted for approval</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <AppraisalScoreFields categories={template.categories} inputs={inputs} result={result} onChange={change} disabled={!!busy || submitted} review />
      <Field as="textarea" rows={3} label="Overall comment" value={comment} maxLength={4000} disabled={!!busy || submitted}
        onChange={event => setComment(event.target.value)} />
    </div>
  </Modal>;
}
