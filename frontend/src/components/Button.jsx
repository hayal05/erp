import { Loader2 } from 'lucide-react';

// variant: default (outlined pill) | primary | danger. `busy` disables the button and shows a spinner
// so a slow request cannot be submitted twice. Defaults to type="button" (never submits a form by accident).
export default function Button({ variant = 'default', size, busy = false, type = 'button', className = '', children, disabled, ...rest }) {
  const cls = ['btn', variant !== 'default' && variant, size, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
