import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Accessible dialog: portal to <body>, focus moves in and returns to the opener on close, Tab is
// trapped, Esc and backdrop click close it, page scroll is locked. `dismissible={false}` is for
// dialogs that must be answered (e.g. the QR unlock re-authentication in Phase 2).
export default function Modal({ open, title, onClose, children, footer, wide = false, dismissible = true }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // always call the latest handler without re-running the focus effect

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    document.body.classList.add('modal-open');
    const dlg = ref.current;
    (dlg.querySelector('[autofocus],input,select,textarea') ?? dlg).focus();

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      const items = [...dlg.querySelectorAll(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); return; }
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dlg)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      opener?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {dismissible && <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>}
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
