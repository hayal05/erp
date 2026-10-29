import Button from '../components/Button.jsx';

// Read-only salary facts of one package. Used for the new-employee preview and for both sides of the comparison.
function Package({ title, data, id }) {
  return (
    <div className="salary-pkg" role="group" aria-labelledby={id}>
      <strong id={id}>{title}</strong>
      <dl>
        <dt>Basic salary</dt><dd>{data.basic}</dd>
        <dt>Allowance</dt><dd>{data.allowance}{data.allowanceNote && <small className="muted"> ({data.allowanceNote})</small>}</dd>
        <dt>Pension applies</dt><dd>{data.pension}</dd>
        <dt>Basic plus allowance</dt><dd><strong>{data.total}</strong></dd>
      </dl>
    </div>
  );
}

// The salary part of the employee form (task 6.10). `plan` comes from salaryPlan() in employeeForm.js; `profile` is the load state of the
// employee's current salary ({ status: 'idle' | 'loading' | 'ready' | 'error', error }).
export default function PositionSalaryPreview({ plan, profile, busy, onApplyChange, onRetry }) {
  if (plan.kind === 'none') return null;

  if (plan.kind === 'cleared') {
    return <p className="muted full">Removing the position keeps the employee's current salary and job title.</p>;
  }

  if (plan.kind === 'preview') {
    return (
      <div className="stack full" aria-live="polite">
        <Package title="Salary from position" data={plan.next} id="salary-preview" />
        <small className="muted">This salary is saved with the new employee. It can be changed afterwards for this person only, with the Salary button.</small>
      </div>
    );
  }

  // plan.kind === 'change'
  return (
    <div className="stack full" aria-live="polite">
      {profile.status === 'loading' && <p role="status" className="muted">Loading the current salary…</p>}
      {profile.status === 'error' && (
        <p className="form-error" role="alert">Could not load the current salary: {profile.error} <Button size="sm" onClick={onRetry}>Try again</Button></p>
      )}
      <div className="salary-compare">
        {plan.current && <Package title="Current salary" data={plan.current} id="salary-current" />}
        <Package title="New position salary" data={plan.next} id="salary-next" />
      </div>
      {plan.same && <p className="muted">The new position has the same salary as the current one.</p>}
      <label>
        <input type="checkbox" checked={plan.apply} disabled={busy} onChange={(e) => onApplyChange(e.target.checked)} /> Apply new position salary
      </label>
      <small className="muted">
        {plan.apply
          ? 'The salary will be replaced when you save. Draft payrolls use it; approved payrolls keep their saved amounts.'
          : 'The current salary stays as it is. Use this for exceptional cases; you can still change it later with the Salary button.'}
      </small>
    </div>
  );
}
