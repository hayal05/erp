import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { appraisalWeightStatus } from '../../../shared/appraisalWeights.mjs';
import { scoringRuleError } from '../../../shared/appraisalScoring.mjs';
import { appraisalBracketStatus } from '../../../shared/appraisalRatings.mjs';
import AppraisalRatings, { boundaryText, boundaryValue, invalidBoundary, MandatoryCriterion } from './AppraisalRatings.jsx';
import AppraisalScoringRule from './AppraisalScoringRule.jsx';
import { put } from '../api/client.js';
import { formatMoney } from '../api/money.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';

const emptyRow = () => ({ id: crypto.randomUUID(), name: '', weight: '' });
const percent = weight => `${formatMoney(weight)}%`;
const fromSaved = row => ({ ...row, weight: row.weight == null ? '' : formatMoney(row.weight) });

function changed(rows, id, update) {
  return rows.map(row => row.id === id ? update(row) : row);
}

function moved(rows, index, direction) {
  const copy = [...rows];
  const destination = index + direction;
  [copy[index], copy[destination]] = [copy[destination], copy[index]];
  return copy;
}

export default function AppraisalWeights({ template, onClose, onSaved }) {
  const path = `/appraisals/templates/${template.id}/structure`;
  const draft = useResource(path);
  if (draft.data?.categories) {
    return <WeightEditor template={template} draft={draft.data} path={path} onClose={onClose} onSaved={onSaved} />;
  }
  return <Modal open title={`Scorecard · ${template.name}`} onClose={onClose}>
    <ResourceState loading={draft.loading} error={draft.error} onRetry={draft.reload} />
  </Modal>;
}

function WeightEditor({ template, draft, path, onClose, onSaved }) {
  const [categories, setCategories] = useState(() => draft.categories.map(category => ({
    ...fromSaved(category), criteria: category.criteria.map(criterion => ({
      ...fromSaved(criterion),
      ...(criterion.mandatory ? { mandatory: {
        minimum: boundaryText(criterion.mandatory.minimum), ceiling: boundaryText(criterion.mandatory.ceiling),
      } } : {}),
    })),
  })));
  const [brackets, setBrackets] = useState(() => (draft.brackets ?? []).map(row => ({
    ...row, min: boundaryText(row.min), max: boundaryText(row.max),
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const payload = categories.map(category => ({
    ...category, weight: boundaryValue(category.weight),
    criteria: category.criteria.map(criterion => ({
      ...criterion, weight: boundaryValue(criterion.weight),
      ...(criterion.mandatory ? { mandatory: {
        minimum: boundaryValue(criterion.mandatory.minimum), ceiling: boundaryValue(criterion.mandatory.ceiling),
      } } : {}),
    })),
  }));
  const status = appraisalWeightStatus(payload);
  const invalidWeight = categories.some(category => [category, ...category.criteria]
    .some(row => row.weight.trim() && boundaryValue(row.weight) === null));

  const invalidScoring = categories.some(category => category.criteria
    .some(criterion => criterion.scoring && scoringRuleError(criterion.scoring)));
  const ratingBrackets = brackets.map(row => ({ ...row, min: boundaryValue(row.min), max: boundaryValue(row.max) }));
  const ratings = appraisalBracketStatus(ratingBrackets);
  const invalidRatings = brackets.some(row => invalidBoundary(row.min) || invalidBoundary(row.max));
  const invalidMandatory = payload.some(category => category.criteria.some(({ mandatory }) =>
    mandatory && (mandatory.minimum === null || mandatory.ceiling === null)));
  const invalid = invalidWeight || invalidScoring || invalidRatings || invalidMandatory;

  function editCategory(id, update) {
    setCategories(rows => changed(rows, id, update));
  }

  async function save(event) {
    event.preventDefault();
    if (busy || invalid) return;
    setBusy(true);
    setError('');
    try {
      await put(path, { version: draft.version, categories: payload, brackets: ratingBrackets });
      toast.success('Template draft saved');
      onSaved();
    } catch (err) {
      if (err.code === 'approval_pending') {
        toast.success(err.message);
        onSaved();
      } else {
        setError(err.fields?.categories ?? err.fields?.brackets ?? err.message);
        setBusy(false);
      }
    }
  }

  return <Modal open wide title={`Scorecard · ${template.name}`} dismissible={!busy}
    onClose={() => !busy && onClose()} footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" form="appraisal-weight-form" variant="primary" busy={busy} disabled={invalid}>Save draft</Button>
    </>}>
    <form id="appraisal-weight-form" className="stack" onSubmit={save} noValidate>
      <div className="row between">
        <strong aria-live="polite">Category weights · {percent(status.total)} / 100% · {status.ready ? 'Weights complete' : 'Weights incomplete'}</strong>
        <Button size="sm" disabled={busy} onClick={() => setCategories(rows => [...rows, { ...emptyRow(), criteria: [] }])}>Add category</Button>
      </div>
      {invalidScoring && <p className="form-error" role="alert">Check the scoring rules marked Needs attention.</p>}
      {invalidMandatory && <p className="form-error" role="alert">Enter both scores for every mandatory criterion.</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {categories.map((category, index) => {
        const group = status.groups[index];
        const label = `Category ${index + 1}`;
        return <section className="card stack" key={category.id} aria-label={label}>
          <div className="row between">
            <strong>{label}</strong>
            <OrderControls label={label} index={index} length={categories.length} disabled={busy}
              onMove={direction => setCategories(rows => moved(rows, index, direction))}
              onRemove={() => setCategories(rows => rows.filter(row => row.id !== category.id))} />
          </div>
          <WeightFields row={category} label={label} disabled={busy}
            onChange={values => editCategory(category.id, row => ({ ...row, ...values }))} />
          <div className="row between">
            <small className="muted">Criterion weights · {percent(group.total)} / 100%{group.ready ? ' · Complete' : ''}</small>
            <Button size="sm" disabled={busy} onClick={() => editCategory(category.id, row => ({ ...row, criteria: [...row.criteria, emptyRow()] }))}>Add criterion</Button>
          </div>
          {category.criteria.map((criterion, criterionIndex) => {
            const label = `Category ${index + 1}, criterion ${criterionIndex + 1}`;
            return <div className="stack" key={criterion.id}>
              <div className="row between">
                <strong>Criterion {criterionIndex + 1}</strong>
                <OrderControls label={label} index={criterionIndex} length={category.criteria.length} disabled={busy}
                  onMove={direction => editCategory(category.id, row => ({ ...row, criteria: moved(row.criteria, criterionIndex, direction) }))}
                  onRemove={() => editCategory(category.id, row => ({ ...row, criteria: row.criteria.filter(item => item.id !== criterion.id) }))} />
              </div>
              <WeightFields row={criterion} label={label} disabled={busy}
                onChange={values => editCategory(category.id, row => ({
                  ...row, criteria: changed(row.criteria, criterion.id, item => ({ ...item, ...values })),
                }))} />
              <AppraisalScoringRule scoring={criterion.scoring} disabled={busy}
                onChange={scoring => editCategory(category.id, row => ({
                  ...row, criteria: changed(row.criteria, criterion.id, item => ({ ...item, scoring })),
                }))} />
              <MandatoryCriterion rule={criterion.mandatory} disabled={busy}
                onChange={mandatory => editCategory(category.id, row => ({
                  ...row, criteria: changed(row.criteria, criterion.id, item => ({ ...item, mandatory })),
                }))} />
            </div>;
          })}
        </section>;
      })}
      <AppraisalRatings brackets={brackets} status={ratings} onChange={setBrackets} disabled={busy} />
    </form>
  </Modal>;
}

function WeightFields({ row, label, onChange, disabled }) {
  const error = row.weight.trim() && boundaryValue(row.weight) === null ? 'Enter 0–100 with up to two decimal places' : '';
  return <div className="form-grid">
    <Field label="Name" aria-label={`${label} name`} value={row.name} maxLength={120} disabled={disabled}
      onChange={event => onChange({ name: event.target.value })} />
    <Field label="Weight (%)" aria-label={`${label} weight percent`} value={row.weight} inputMode="decimal" error={error}
      disabled={disabled} onChange={event => onChange({ weight: event.target.value })} />
  </div>;
}

function OrderControls({ label, index, length, onMove, onRemove, disabled }) {
  return <div className="row">
    <Button size="sm" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}><ArrowUp size={16} aria-hidden="true" /></Button>
    <Button size="sm" aria-label={`Move ${label} down`} disabled={disabled || index === length - 1} onClick={() => onMove(1)}><ArrowDown size={16} aria-hidden="true" /></Button>
    <Button size="sm" aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove}>Remove</Button>
  </div>;
}
