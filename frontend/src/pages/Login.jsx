import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../api/auth.jsx';

// Turn a failed login into one message the person can act on. Fields are only flagged for
// client/server validation problems; a wrong password never says which of the two was wrong.
function describe(e) {
  if (e.code === 'rate_limited') {
    const mins = Math.max(1, Math.ceil((e.details?.retryAfterSeconds ?? 60) / 60));
    return `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
  }
  return e.message || 'Something went wrong. Please try again.';
}

// Redirect after success is handled by LoginRoute in App.jsx (it reads the saved `from` page).
export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const errId = useId();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return; // ignore double taps
    const missing = {};
    if (!form.username.trim()) missing.username = 'Enter your username';
    if (!form.password) missing.password = 'Enter your password';
    setFields(missing);
    setError('');
    if (Object.keys(missing).length) return;

    setBusy(true);
    try {
      await login(form.username, form.password); // on success the route re-renders and redirects
    } catch (err) {
      setFields(err.code === 'validation' ? err.fields : {});
      setError(describe(err));
      if (err.status === 401 || err.status === 429) setForm((f) => ({ ...f, password: '' }));
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate aria-describedby={error ? errId : undefined}>
        <h1>Natra ERP</h1>

        {error && <div id={errId} className="form-error" role="alert">{error}</div>}

        <label className="field">
          <span>Username</span>
          <input type="text" name="username" autoComplete="username" inputMode="text" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} autoFocus value={form.username} onChange={set('username')}
            aria-invalid={!!fields.username} maxLength={254} />
          {fields.username && <small className="field-error">{fields.username}</small>}
        </label>

        <label className="field">
          <span>Password</span>
          <span className="password-row">
            <input type={show ? 'text' : 'password'} name="password" autoComplete="current-password"
              value={form.password} onChange={set('password')} aria-invalid={!!fields.password} maxLength={256} />
            <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          {fields.password && <small className="field-error">{fields.password}</small>}
        </label>

        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
