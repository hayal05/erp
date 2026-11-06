import { FULL_WEIGHT } from '../../../shared/appraisalWeights.mjs';
import { formatMoney, tryMoney } from '../api/money.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';

export const boundaryText = value => value == null ? '' : formatMoney(value);
export function boundaryValue(value) {
  const points = tryMoney(value);
  return points != null && points <= FULL_WEIGHT ? points : null;
}
export const invalidBoundary = value => Boolean(value.trim()) && boundaryValue(value) === null;

export default function AppraisalRatings({ brackets, status, onChange, disabled }) {
  function update(index, field, event) {
    const value = event.target.value;
    onChange(brackets.map((bracket, i) => i === index ? { ...bracket, [field]: value } : bracket));
  }

  return <section className="card stack" aria-label="Rating brackets">
    <div className="row between">
      <strong>Rating brackets · {status.ready ? 'Complete' : 'Incomplete'}</strong>
      <Button size="sm" disabled={disabled} onClick={() => onChange([...brackets, { label: '', min: '', max: '' }])}>Add bracket</Button>
    </div>
    <small className="muted">From is inclusive. To is exclusive except at 100%.</small>
    {brackets.map((bracket, index) => <div className="row" key={index}>
      <Field label="Rating label" maxLength={120} value={bracket.label} disabled={disabled} onChange={event => update(index, 'label', event)} />
      <Field label="From (%)" inputMode="decimal" value={bracket.min} disabled={disabled} onChange={event => update(index, 'min', event)}
        error={invalidBoundary(bracket.min) ? 'Enter 0–100 with up to two decimals' : ''} />
      <Field label="To (%)" inputMode="decimal" value={bracket.max} disabled={disabled} onChange={event => update(index, 'max', event)}
        error={invalidBoundary(bracket.max) ? 'Enter 0–100 with up to two decimals' : ''} />
      <Button size="sm" disabled={disabled} aria-label={`Remove bracket ${index + 1}`}
        onClick={() => onChange(brackets.filter((_, i) => i !== index))}>Remove</Button>
    </div>)}
    {!status.ready && <ul className="muted">{status.errors.map(message => <li key={message}>{message}</li>)}</ul>}
  </section>;
}

export function MandatoryCriterion({ rule, onChange, disabled }) {
  return <div className="stack full">
    <label><input type="checkbox" checked={Boolean(rule)} disabled={disabled}
      onChange={event => onChange(event.target.checked ? { minimum: '', ceiling: '' } : null)} /> Mandatory criterion</label>
    {rule && <div className="form-grid">
      <Field label="Minimum score (%)" inputMode="decimal" value={rule.minimum} disabled={disabled}
        error={boundaryValue(rule.minimum) == null ? 'Enter 0–100 with up to two decimals' : ''}
        onChange={event => onChange({ ...rule, minimum: event.target.value })} />
      <Field label="Rating ceiling (%)" inputMode="decimal" value={rule.ceiling} disabled={disabled}
        error={boundaryValue(rule.ceiling) == null ? 'Enter 0–100 with up to two decimals' : ''}
        onChange={event => onChange({ ...rule, ceiling: event.target.value })} />
      <small className="muted full">A score below the minimum, or an excluded result, caps the rating. The weighted score stays visible.</small>
    </div>}
  </div>;
}
