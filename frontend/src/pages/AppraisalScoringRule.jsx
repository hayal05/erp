import { defaultScoringRule, scoringRuleError } from '../../../shared/appraisalScoring.mjs';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';

const methods = [
  { value: 'rating', label: 'Reviewer rating (0–100)' },
  { value: 'higher', label: 'Higher is better' },
  { value: 'lower', label: 'Lower is better' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'lookup', label: 'Custom scoring table' },
];
const missingPolicies = [
  { value: 'required', label: 'Require input' },
  { value: 'zero', label: 'Score as zero' },
  { value: 'exclude', label: 'Exclude criterion' },
];
const numberValue = event => Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : null;

export default function AppraisalScoringRule({ scoring, onChange, disabled }) {
  const rule = scoring ?? defaultScoringRule();
  const error = scoringRuleError(rule);
  const update = change => onChange({ ...rule, ...change });
  const set = field => event => update({ [field]: numberValue(event) });

  function changeMethod(method) {
    const { cap, missing, allowNotApplicable } = rule;
    onChange({ ...defaultScoringRule(method), cap, missing, allowNotApplicable });
  }

  function changeThreshold(index, field, event) {
    const value = numberValue(event);
    update({ thresholds: rule.thresholds.map((row, i) => i === index ? { ...row, [field]: value } : row) });
  }

  return <details className="stack">
    <summary>Scoring · {methods.find(method => method.value === rule.method)?.label}{error ? ' · Needs attention' : ''}</summary>
    <div className="form-grid">
      <Field as="select" label="Scoring method" options={methods} value={rule.method} disabled={disabled}
        onChange={event => changeMethod(event.target.value)} />
      <Field type="number" label="Score cap" min={0} max={100} step="any" value={rule.cap ?? ''} disabled={disabled} onChange={set('cap')} />
      <Field as="select" label="Missing input" options={missingPolicies} value={rule.missing} disabled={disabled}
        onChange={event => update({ missing: event.target.value })} />
      <label><input type="checkbox" checked={rule.allowNotApplicable} disabled={disabled}
        onChange={event => update({ allowNotApplicable: event.target.checked })} /> Allow not applicable</label>
      {(rule.method === 'higher' || rule.method === 'lower') && <Field type="number" label="Target" min={0}
        step="any" value={rule.target ?? ''} disabled={disabled} onChange={set('target')}
        hint={rule.method === 'higher' ? 'Actual ÷ target × 100 before the cap.' : 'Target ÷ actual × 100. Zero actual earns 100 before the cap.'} />}
      {rule.method === 'yes_no' && <>
        <Field type="number" label="Yes score" min={0} max={100} step="any" value={rule.yesScore ?? ''} disabled={disabled} onChange={set('yesScore')} />
        <Field type="number" label="No score" min={0} max={100} step="any" value={rule.noScore ?? ''} disabled={disabled} onChange={set('noScore')} />
      </>}
      {rule.method === 'lookup' && <div className="stack full">
        <Field type="number" label="Score below first threshold" min={0} max={100} step="any"
          value={rule.belowScore ?? ''} disabled={disabled} onChange={set('belowScore')} />
        <small className="muted">The highest threshold met sets the score.</small>
        {rule.thresholds.map((row, index) => <div className="row" key={index}>
          <Field type="number" label={`Threshold ${index + 1}`} step="any" value={row.minimum ?? ''} disabled={disabled}
            onChange={event => changeThreshold(index, 'minimum', event)} />
          <Field type="number" label={`Score ${index + 1}`} min={0} max={100} step="any" value={row.score ?? ''} disabled={disabled}
            onChange={event => changeThreshold(index, 'score', event)} />
          <Button size="sm" disabled={disabled} onClick={() => update({ thresholds: rule.thresholds.filter((_, i) => i !== index) })}>Remove</Button>
        </div>)}
        <div><Button size="sm" disabled={disabled} onClick={() => update({ thresholds: [...rule.thresholds, { minimum: null, score: null }] })}>Add threshold</Button></div>
      </div>}
      {error && <small className="form-error full" role="alert">{error}</small>}
    </div>
  </details>;
}
