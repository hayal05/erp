import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, QrCode, RotateCcw, Send } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { Badge } from '../../components/Table.jsx';
import { post } from '../../api/client.js';
import { blobToBase64, captureSelfie, describeCameraError } from '../../api/image.js';
import { tokenFromLocation } from './scanToken.js';
import { confirmationView, describeScanError } from './attendanceView.js';

// Employee scan page (/portal/scan). 2.10: receive the token and keep it safe. 2.11: front camera, preview, capture,
// retake, compression. 2.19: submit + confirmation. There is deliberately no <input type="file">: live camera only (spec 7).
// Steps: idle -> starting -> live -> captured -> sending -> done | failed. The photo is held in memory only and is sent
// only when the person taps "Use this photo". The server decides check-in vs check-out; this page never sends an action.
export default function Scan() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => tokenFromLocation(location), [location]);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const alive = useRef(true);
  const [step, setStep] = useState('idle');
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null); // { blob, url, kb }
  const [failure, setFailure] = useState(null); // { message, next } from describeScanError
  const [done, setDone] = useState(null); // confirmationView(...) after a successful scan
  const sending = useRef(false); // synchronous guard: a double tap must not send twice

  // Move the token from the URL fragment into history state, so it is not left in the address bar,
  // bookmarks or the browser history list. replace: Back must not return to the URL with the token.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: token ? { qrToken: token } : null });
  }, [location.hash, location.pathname, location.search, navigate, token]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Turn the camera off (and free the photo) when leaving the page.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stopCamera(); };
  }, [stopCamera]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  async function startCamera() {
    setError('');
    setFailure(null);
    setPhoto(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError(describeCameraError(new Error('unsupported'))); return; }
    setStep('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!alive.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      setStep('live'); // the <video> mounts now; the effect below attaches the stream
    } catch (e) {
      if (alive.current) { setError(describeCameraError(e)); setStep('idle'); }
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (step === 'live' && video && streamRef.current) { video.srcObject = streamRef.current; video.play?.().catch(() => {}); }
  }, [step]);

  async function capture() {
    setError('');
    try {
      const out = await captureSelfie(videoRef.current);
      if (!alive.current) return;
      stopCamera(); // camera light off while the person reviews the photo
      setPhoto({ blob: out.blob, url: URL.createObjectURL(out.blob), kb: Math.round(out.blob.size / 1024) });
      setStep('captured');
    } catch {
      setError('The photo could not be taken. Wait a moment for the camera to load and try again.');
    }
  }

  async function submit() {
    if (!photo || !token || sending.current) return;
    sending.current = true;
    setError('');
    setFailure(null);
    setStep('sending');
    try {
      const body = { token, photo: await blobToBase64(photo.blob) };
      const res = await post('/attendance/scan', body);
      if (!alive.current) return;
      setDone(confirmationView(res));
      setPhoto(null); // frees the preview URL; the selfie now lives only on the server
      setStep('done');
      // The code is spent: drop it from history state so a refresh or Back cannot offer it again.
      navigate({ pathname: location.pathname }, { replace: true, state: null });
    } catch (e) {
      if (!alive.current) return;
      const f = describeScanError(e);
      setFailure(f);
      if (f.next === 'rescan' || f.next === 'stop') { setPhoto(null); setStep('failed'); } // nothing to retry: do not keep the selfie around
      else setStep('captured'); // keep the photo so Try again / Retake works
    } finally { sending.current = false; }
  }

  // Success is checked before the token: the token was just removed from history state.
  if (step === 'done' && done) {
    return (
      <section className="stack">
        <h1>{done.heading}</h1>
        <div className="card stack scan-done" role="status">
          <p className="scan-done-title"><CheckCircle2 size={28} aria-hidden="true" /> <strong>{done.name}</strong></p>
          <dl className="scan-summary">
            <div><dt>Date</dt><dd>{done.date}</dd></div>
            <div><dt>Time</dt><dd>{done.time}</dd></div>
            <div><dt>Check-in</dt><dd>{done.checkIn}</dd></div>
            <div><dt>Check-out</dt><dd>{done.checkOut}</dd></div>
            <div><dt>Status</dt><dd><Badge tone={done.tone}>{done.status}</Badge></dd></div>
          </dl>
          <div className="row">
            <Link className="btn primary" to="/portal/attendance">View my attendance</Link>
            <Link className="btn" to="/portal">Home</Link>
          </div>
        </div>
      </section>
    );
  }
  if (step === 'failed' && failure) {
    return (
      <section className="stack">
        <h1>Not recorded</h1>
        <div className="card stack">
          <p className="form-error" role="alert">{failure.message}</p>
          <div className="row"><Link className="btn" to="/portal/attendance">View my attendance</Link><Link className="btn" to="/portal">Home</Link></div>
        </div>
      </section>
    );
  }

  if (!token) {
    return (
      <section className="stack">
        <h1>Scan to check in</h1>
        <div className="card stack">
          <QrCode size={28} aria-hidden="true" />
          <p>Scan the office attendance QR code.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="stack">
      <h1>Check in or out</h1>
      <div className="card stack">
        {step === 'idle' || step === 'starting' ? (
          <>
            <p>Take a selfie, then confirm to submit.</p>
            <Button variant="primary" busy={step === 'starting'} onClick={startCamera}><Camera size={18} aria-hidden="true" /> Open camera</Button>
          </>
        ) : null}
        {step === 'live' ? (
          <>
            <div className="selfie-frame"><video ref={videoRef} className="selfie-video" playsInline muted autoPlay aria-label="Live camera preview" /></div>
            <Button variant="primary" onClick={capture}><Camera size={18} aria-hidden="true" /> Take photo</Button>
          </>
        ) : null}
        {(step === 'captured' || step === 'sending') && photo ? (
          <>
            <div className="selfie-frame"><img className="selfie-img" src={photo.url} alt="Your selfie, ready to confirm" /></div>
            <p className="muted">Photo size: {photo.kb} KB</p>
            <div className="row">
              <Button onClick={startCamera} disabled={step === 'sending'}><RotateCcw size={18} aria-hidden="true" /> Retake</Button>
              <Button variant="primary" onClick={submit} busy={step === 'sending'} disabled={failure?.next === 'retake'}>
                <Send size={18} aria-hidden="true" /> {failure ? 'Try again' : 'Use this photo'}
              </Button>
            </div>
            {step === 'sending' ? <p className="muted" role="status">Sending… please wait.</p> : null}
          </>
        ) : null}
        {failure && step === 'captured' ? <p className="form-error" role="alert">{failure.message}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
