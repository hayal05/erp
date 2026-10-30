import { useEffect, useState } from 'react';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import Table, { Pager } from '../../components/Table.jsx';
import { get, put } from '../../api/client.js';
import { useToast } from '../../components/Toast.jsx';
import { formatWorkDate } from '../attendanceForm.js';
import { tenure, employmentLabel } from './profileView.js';
const SIZE = 10;
export default function Profile() {
  const toast = useToast();
  const [profile, setProfile] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState(''), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [saveError, setSaveError] = useState('');
  const [page, setPage] = useState(1), [history, setHistory] = useState({ items: [], total: 0, loading: true, error: '' });
  useEffect(() => {
    const ctrl = new AbortController(); setError('');
    get('/profile', {}, { signal: ctrl.signal }).then(p => { if (!ctrl.signal.aborted) { setProfile(p); setSummary(p.experienceSummary); } })
      .catch(e => { if (!ctrl.signal.aborted) setError(e.message); });
    return () => ctrl.abort();
  }, [retry]);
  useEffect(() => {
    const ctrl = new AbortController(); setHistory(h => ({ ...h, loading: true, error: '' }));
    get('/profile/positions', { page, pageSize: SIZE }, { signal: ctrl.signal })
      .then(h => { if (!ctrl.signal.aborted) setHistory({ ...h, loading: false, error: '' }); })
      .catch(e => { if (!ctrl.signal.aborted) setHistory({ items: [], total: 0, loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, retry]);
  async function save(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setSaveError('');
    try {
      const saved = await put('/profile/experience', { experienceSummary: summary.trim() || null });
      setProfile(p => ({ ...p, ...saved })); setSummary(saved.experienceSummary); setEditing(false); toast.success('Experience saved');
    } catch (e) { setSaveError(e.message); } finally { setBusy(false); }
  }
  if (error) return <section className="stack"><h1>My profile</h1><p role="alert" className="form-error">{error}</p><Button onClick={() => setRetry(n => n + 1)}>Retry</Button></section>;
  if (!profile) return <p role="status">Loading profile…</p>;
  const facts = [['Employee ID', profile.employeeCode], ['Department', profile.department], ['Position', profile.position],
    ['Username',profile.username], ['Email', profile.email], ['Phone', profile.phone], ['Employment type', employmentLabel(profile.employmentType)],
    ['Status', profile.status], ['Joined', formatWorkDate(profile.startDate)], ['Time employed', tenure(profile.startDate, profile.today)], ['Shift', profile.shift]];
  return <section className="stack">
    <h1>My profile</h1>
    <div className="card stack"><h2>{profile.fullName}</h2><dl className="profile-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>
      <p className="muted">Contact HR to update these details.</p></div>
    <div className="card stack"><div className="row between"><h2>Work experience</h2>{!editing && <Button onClick={() => { setSummary(profile.experienceSummary); setSaveError(''); setEditing(true); }}>Edit experience</Button>}</div>
      {editing ? <form className="stack" onSubmit={save}>
        <Field as="textarea" label="Experience summary" value={summary} maxLength={5000} rows={6} disabled={busy} onChange={e => setSummary(e.target.value)} />
        <small className="muted">Previous employers, roles and dates. {summary.length}/5000</small>
        {saveError && <p role="alert" className="form-error">{saveError}</p>}
        <div className="row"><Button disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save experience</Button></div>
      </form> : <p className="profile-summary">{profile.experienceSummary || 'No experience summary added yet.'}</p>}
    </div>
    <div className="card stack"><h2>Position history</h2><p className="muted">History starts when tracking began. Starting-record dates are not appointment dates.</p>
      <Table caption="Your position history" columns={[
        { key: 'recordedOn', header: 'Recorded', render: r => formatWorkDate(r.recordedOn) },
        { key: 'department', header: 'Department', render: r => r.department || 'Not assigned' },
        { key: 'position', header: 'Position', render: r => r.position || 'Not assigned' },
        { key: 'baseline', header: 'Record', render: r => r.baseline ? 'Starting record' : 'Assignment update' },
      ]} rows={history.items} loading={history.loading} error={history.error} onRetry={() => setRetry(n => n + 1)} empty="No position history recorded yet" />
      <Pager page={page} pageSize={SIZE} total={history.total} onPage={setPage} disabled={history.loading} />
    </div>
  </section>;
}
