import Skeleton from '../components/Skeleton.jsx';
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
        <dt>Total</dt><dd><strong>{data.total}</strong></dd>
      </dl>
    </div>
  );
}

// The salary part of the employee form (task 6.10). `plan` comes from salaryPlan() in employeeForm.js; `profile` is the load state of the
// employee's current salary ({ status: 'idle' | 'loading' | 'ready' | 'error', error }).
export default function PositionSalaryPreview({ plan, profile, busy, onApplyChange, onRetry }) {
  if (plan.kind === 'none') return null;

  if (plan.kind === 'cleared') {
    return <p className="muted full">Current salary and title will be kept.</p>;
  }

  if (plan.kind === 'preview') {
    return (
      <div className="stack full" aria-live="polite">
        <Package title="Salary from position" data={plan.next} id="salary-preview" />
        <small className="muted">Applied on save.</small>
      </div>
    );
  }

  // plan.kind === 'change'
  return (
    <div className="stack full" aria-live="polite">
      {profile.status === 'loading' && <Skeleton label="Loading the current salary…" />}
      {profile.status === 'error' && (
        <p className="form-error" role="alert">Could not load the current salary: {profile.error} <Button size="sm" onClick={onRetry}>Try again</Button></p>
      )}
      <div className="salary-compare">
        {plan.current && <Package title="Current salary" data={plan.current} id="salary-current" />}
        <Package title="New position salary" data={plan.next} id="salary-next" />
      </div>
      {plan.same && <p className="muted">Salary is unchanged.</p>}
      <label>
        <input type="checkbox" checked={plan.apply} disabled={busy} onChange={(e) => onApplyChange(e.target.checked)} /> Apply new position salary
      </label>
      <small className="muted">
        {plan.apply
          ? 'Replaces the employee salary on save.'
          : 'Keeps the current employee salary.'}
      </small>
    </div>
  );
}
