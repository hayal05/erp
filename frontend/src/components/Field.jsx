import { useId } from 'react';
import { Search } from 'lucide-react';

// Labelled form control with hint + error wiring (aria-invalid / aria-describedby).
//   <Field label="Email" type="email" value={v} onChange={...} error={fields.email} />
//   <Field as="select" label="Department" options={[{ value: 1, label: 'Sales' }]} placeholder="Choose…" />
//   <Field as="textarea" label="Reason" />
export default function Field({ label, error, hint, as = 'input', options = [], placeholder, className = '', hideLabel = false, ...rest }) {
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
  else if (rest.type === 'search') control = <span className="search-control"><input {...common} placeholder={placeholder} /><Search className="search-icon" size={18} aria-hidden="true" focusable="false" /></span>;
  else control = <input {...common} placeholder={placeholder} />;

  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id} className={hideLabel || rest.type === 'search' ? 'sr-only' : undefined}>{label}</label>
      {control}
      {hint && <small id={`${id}-hint`} className="field-hint">{hint}</small>}
      {error && <small id={`${id}-err`} className="field-error">{error}</small>}
    </div>
  );
}
