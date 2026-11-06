import { useState } from 'react';
import { previewAppraisal } from '../../../shared/appraisalPreview.mjs';
import Field from '../components/Field.jsx';

const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const points = value => value == null ? '—' : value.toFixed(2);

export default function AppraisalScorePreview({ categories, brackets, disabled = false }) {
  const [inputs, setInputs] = useState({});
  const sample = Object.fromEntries(categories.flatMap(category => category.criteria.map(criterion => {
    const input = inputs[criterion.id];
    return [criterion.id, { ...input, notApplicable: criterion.scoring?.allowNotApplicable && input?.notApplicable }];
  })));
  const result = previewAppraisal(categories, brackets, sample);
  const change = (id, value) => setInputs(current => ({ ...current, [id]: { ...current[id], ...value } }));

  return <details className="card stack">
    <summary>Score preview</summary>
    <AppraisalScoreFields categories={categories} inputs={sample} result={result} onChange={change} disabled={disabled} />
  </details>;
}

export function AppraisalScoreFields({ categories, inputs, result, onChange, disabled, review = false }) {
  return <>
    {result.status === 'configuration' ? <p className="muted">Complete the weights and rating brackets to preview a score.</p> :
      <div className="stack">
        {categories.map((category, index) => {
          const group = result.categories[index];
          return <section className="stack" key={category.id}>
            <div className="row between">
              <strong>{category.name}</strong>
              <small>Category score {points(group.score)} · Overall points {points(group.contribution)}</small>
            </div>
            {category.criteria.map((criterion, i) => {
              const input = inputs[criterion.id];
              const row = group.criteria[i];
              const binary = criterion.scoring?.method === 'yes_no';
              const value = binary ? typeof input?.value === 'boolean' ? input.value ? 'yes' : 'no' : '' :
                typeof input?.value === 'number' ? input.value : '';
              return <div className="row between" key={criterion.id}>
                {binary ? <Field as="select" label={criterion.name} value={value} options={yesNo}
                  placeholder={review ? 'Choose result' : 'Choose sample input'} disabled={disabled || input?.notApplicable}
                  onChange={event => onChange(criterion.id, { value: event.target.value ? event.target.value === 'yes' : null })} /> :
                  <Field type="number" label={criterion.name} step="any" value={value} placeholder={review ? 'Enter result' : 'Sample input'}
                    disabled={disabled || input?.notApplicable}
                    onChange={event => onChange(criterion.id, { value: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : null })} />}
                {criterion.scoring?.allowNotApplicable && <label>
                  <input type="checkbox" checked={Boolean(input?.notApplicable)} disabled={disabled}
                    onChange={event => onChange(criterion.id, { notApplicable: event.target.checked })} /> Not applicable
                </label>}
                {review && <Field as="textarea" rows={2} label={`Comment · ${criterion.name}`}
                  value={input?.comment ?? ''} maxLength={2000} disabled={disabled}
                  onChange={event => onChange(criterion.id, { comment: event.target.value })} />}
                <small>{row.result.status === 'scored' ? `Score ${points(row.result.score)} · Category points ${points(row.contribution)}`
                  : { missing: 'Input required', excluded: 'Excluded', invalid: 'Invalid input' }[row.result.status]}</small>
              </div>;
            })}
          </section>;
        })}
        <div aria-live="polite">
          {result.rating ? <><strong>Final score {points(result.rating.score)}% · {result.rating.label}</strong>
            {result.rating.cappedBy.length > 0 && <p>Mandatory criteria capped the rating score at {points(result.rating.ratingScore)}%.</p>}</>
            : <p className="muted">{result.status === 'excluded' ? 'No weighted criteria remain to score.' : (review ? 'Complete the required criteria.' : 'Enter valid sample inputs for the required criteria.')}</p>}
        </div>
      </div>}
  </>;
}
