import {usePageRefresh} from '../api/pageRefresh.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Lock, QrCode, RefreshCw, Unlock } from 'lucide-react';
import Button from '../components/Button.jsx';
import UnlockDialog from '../components/UnlockDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { useAuth,usePermission } from '../api/auth.jsx';
import { get,post } from '../api/client.js';
import { formatClock } from '../components/hrNav.js';
import { buildScanUrl, expiryFrom, formatCountdown, remainingSeconds } from './qrState.js';

// Tablet QR page (spec 6): clock, big QR, expiry countdown, Generate / Generate Again, Lock.
// Works in both normal and locked mode; Generate stays active when locked (6.1).
export default function QrAttendance() {
  const pageRefresh = usePageRefresh();
  const toast = useToast();
  const canManage=usePermission('attendance.qr');
  const [status,setStatus]=useState(null);
  useEffect(()=>{if(canManage)return undefined;const ctrl=new AbortController();get('/qr/status',undefined,{signal:ctrl.signal}).then(setStatus).catch(e=>{if(e.name!=='AbortError')setStatus({error:e.message});});return()=>ctrl.abort();},[canManage, pageRefresh]);
  const { locked, setLocked } = useAuth();
  const [qr, setQr] = useState(null);          // { dataUrl, expiresAt } | null
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const latest = useRef(0);                    // ignore a slow response that a newer click has overtaken

  // One timer for the clock and the countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const generate = useCallback(async () => {
    const mine = ++latest.current;
    setBusy(true);
    setError('');
    try {
      const { token, ttlSeconds } = await post('/qr/tokens');
      const receivedAt = Date.now();
      const dataUrl = await QRCode.toDataURL(buildScanUrl(window.location.origin, token),
        { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      if (mine === latest.current) setQr({ dataUrl, expiresAt: expiryFrom(receivedAt, ttlSeconds) });
    } catch (e) {
      if (mine === latest.current) {
        setQr(null);
        setError(e.status === 429 ? 'Too many codes requested. Wait a moment and try again.' : e.message || 'Could not create a QR code.');
      }
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  }, []);

  const lock = async () => {
    setLocking(true);
    try {
      await post('/qr/lock');
      setLocked(true);
    } catch (e) {
      toast.error(e.message || 'Could not lock the screen.');
    } finally {
      setLocking(false);
    }
  };

  const remaining = qr ? remainingSeconds(qr.expiresAt, now) : 0;
  const live = !!qr && remaining > 0;

  return (
    <section className="qr-page" aria-labelledby="qr-title">
      <header className="qr-head">
        <h1 id="qr-title"><QrCode size={22} aria-hidden="true" /> Natra attendance</h1>
        <time className="qr-clock" dateTime={new Date(now).toISOString()}>{formatClock(new Date(now))}</time>
      </header>

      <div className="qr-stage card">
        {live ? (
          <img className="qr-img" src={qr.dataUrl} alt="Attendance QR code. Scan it with your phone camera." width="360" height="360" />
        ) : (
          <div className="qr-placeholder" role="status">
            {!canManage ? 'QR display is managed by HR' : busy ? <Skeleton variant="image" label="Creating QR code…" /> : qr ? 'Code expired' : 'No active code'}
          </div>
        )}
        <p className="qr-countdown" aria-live="off">
          {!canManage?(status?.error||(!status?<Skeleton variant="line" label="Loading QR status…" />:status.active?`A shared code is active until ${new Date(status.expiresAt).toLocaleString()}.`:'No active code.')):live ? <>Expires in <strong>{formatCountdown(remaining)}</strong></> : 'Press the button to show a new code.'}
        </p>
        {canManage && live && <p className="muted">All employees can use this code before it expires. Each employee can use it once.</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
        {canManage ? <div className="qr-actions">
          <Button variant="primary" busy={busy} onClick={generate}>
            {qr ? <><RefreshCw size={16} aria-hidden="true" /> Generate Again</> : 'Generate New QR'}
          </Button>
          {locked ? (
            <Button className="qr-unlock" onClick={() => setUnlocking(true)}><Unlock size={16} aria-hidden="true" /> Unlock</Button>
          ) : (
            <Button busy={locking} onClick={lock}><Lock size={16} aria-hidden="true" /> Lock</Button>
          )}
        </div> : <p className="muted">Read only. HR or Admin generates QR codes and controls the attendance display.</p>}
      </div>
      <UnlockDialog open={unlocking} onClose={() => setUnlocking(false)}
        onUnlocked={() => { setUnlocking(false); setLocked(false); toast.success('Screen unlocked'); }} />
    </section>
  );
}
