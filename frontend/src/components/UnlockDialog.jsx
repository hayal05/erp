import { useEffect, useId, useState } from 'react';
import Button from './Button.jsx';
import Field from './Field.jsx';
import Modal from './Modal.jsx';
import { post } from '../api/client.js';
import { describeUnlockError } from '../pages/qrState.js';

// Re-authentication for the locked tablet (spec 6.2). The password lives only in this component's state:
// it is cleared on every failure, on close, and on success, and is never written to storage.
// The server verifies it, rate-limits attempts, and unlocks this session only.
export default function UnlockDialog({ open, onClose, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errId = useId();

  useEffect(() => { if (!open) { setPassword(''); setError(''); setBusy(false); } }, [open]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!password) { setError('Enter your password'); return; }
    setBusy(true);
    setError('');
    try {
      await post('/qr/unlock', { password });
      setPassword('');
      onUnlocked();
    } catch (err) {
      if (err.code === 'not_locked') { setPassword(''); onUnlocked(); return; } // already unlocked elsewhere
      setError(describeUnlockError(err));
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Unlock this screen" onClose={onClose}>
      <form onSubmit={submit} noValidate aria-describedby={error ? errId : undefined}>
        <p className="muted">Enter your HR password to show the menu again.</p>
        <Field label="Password" type="password" autoComplete="off" autoFocus maxLength={256}
          value={password} onChange={(e) => setPassword(e.target.value)} error={error || undefined} />
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" busy={busy}>Unlock</Button>
        </div>
      </form>
    </Modal>
  );
}
