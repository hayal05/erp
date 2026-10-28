import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { X } from 'lucide-react';
import { toastsReducer, DURATION } from './toasts.js';

const ToastContext = createContext(null);
let nextId = 1;

// <ToastProvider> once near the root, then: const toast = useToast(); toast.success('Saved'); toast.error(err.message)
export function ToastProvider({ children }) {
  const [list, dispatch] = useReducer(toastsReducer, []);
  const timers = useRef(new Map());

  const remove = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    dispatch({ type: 'remove', id });
  }, []);

  const show = useCallback((message, type = 'info') => {
    const id = nextId++;
    dispatch({ type: 'add', toast: { id, type, message: String(message) } });
    timers.current.set(id, setTimeout(() => remove(id), DURATION[type] ?? DURATION.info));
    return id;
  }, [remove]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const api = useMemo(() => ({
    show, remove,
    info: (m) => show(m, 'info'), success: (m) => show(m, 'success'), error: (m) => show(m, 'error'),
  }), [show, remove]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button type="button" className="icon-btn" onClick={() => remove(t.id)} aria-label="Dismiss"><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
