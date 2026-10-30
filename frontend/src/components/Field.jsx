import { useId } from 'react';

// Labelled form control with hint + error wiring (aria-invalid / aria-describedby).
//   <Field label="Email" type="email" value={v} onChange={...} error={fields.email} />
//   <Field as="select" label="Department" options={[{ value: 1, label: 'Sales' }]} placeholder="Choose…" />
//   <Field as="textarea" label="Reason" />
export default function Field({ label, error, hint, as = 'input', options = [], placeholder, className = '', ...rest }) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  const common = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, ...rest };

  let control;
  if (as === 'select') {
    control = (
      <select {...common}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (as === 'textarea') control = <textarea {...common} placeholder={placeholder} />;
  else control = <input {...common} placeholder={placeholder} />;

  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id} className={rest.type === 'search' ? 'sr-only' : undefined}>{label}</label>
      {control}
      {hint && <small id={`${id}-hint`} className="field-hint">{hint}</small>}
      {error && <small id={`${id}-err`} className="field-error">{error}</small>}
    </div>
  );
}
