import {usePageRefresh} from '../../api/pageRefresh.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import { useEffect, useState } from 'react';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import {Badge,Pager} from '../../components/Table.jsx';
import {Briefcase,ContactRound,History,Pencil} from 'lucide-react';
import {initials} from '../../components/hrNav.js';
import { get, put } from '../../api/client.js';
import { useToast } from '../../components/Toast.jsx';
import { formatWorkDate } from '../attendanceForm.js';
import { tenure, employmentLabel } from './profileView.js';
const SIZE = 10;
export default function Profile() {
  const pageRefresh = usePageRefresh();
  const toast = useToast();
  const [profile, setProfile] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState(''), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [saveError, setSaveError] = useState('');
  const [page, setPage] = useState(1), [history, setHistory] = useState({ items: [], total: 0, loading: true, error: '' });
  useEffect(() => {
    const ctrl = new AbortController(); setError('');
    get('/profile', {}, { signal: ctrl.signal }).then(p => { if (!ctrl.signal.aborted) { setProfile(p); setSummary(p.experienceSummary || ''); } })
      .catch(e => { if (!ctrl.signal.aborted) setError(e.message); });
    return () => ctrl.abort();
  }, [retry, pageRefresh]);
  useEffect(() => {
    const ctrl = new AbortController(); setHistory(h => ({ ...h, loading: true, error: '' }));
    get('/profile/positions', { page, pageSize: SIZE }, { signal: ctrl.signal })
      .then(h => { if (!ctrl.signal.aborted) setHistory({ ...h, loading: false, error: '' }); })
      .catch(e => { if (!ctrl.signal.aborted) setHistory({ items: [], total: 0, loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, retry, pageRefresh]);
  async function save(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setSaveError('');
    try {
      const saved = await put('/profile/experience', { experienceSummary: summary.trim() || null });
      setProfile(p => ({ ...p, ...saved })); setSummary(saved.experienceSummary || ''); setEditing(false); toast.success('Experience saved');
    } catch (e) { setSaveError(e.message); } finally { setBusy(false); }
  }
  if (error) return <section className="stack"><h1>My profile</h1><p role="alert" className="form-error">{error}</p><Button onClick={() => setRetry(n => n + 1)}>Retry</Button></section>;
  if (!profile) return <Skeleton variant="profile" label="Loading profile…" />;
  return <ProfileDetails profile={profile} history={history} page={page} onPage={setPage} onRetry={()=>setRetry(n=>n+1)}
    summary={summary} editing={editing} busy={busy} saveError={saveError} onSummaryChange={setSummary} onSave={save}
    onEdit={()=>{setSummary(profile.experienceSummary || '');setSaveError('');setEditing(true);}} onCancel={()=>setEditing(false)}/>;
}

export function ProfileDetails({profile,history,page,onPage,onRetry,summary,editing,busy,saveError,onSummaryChange,onSave,onEdit,onCancel}){
  const contact=[['Username',profile.username],['Email',profile.email],['Phone',profile.phone]];
  const employment=[['Joined',formatWorkDate(profile.startDate)],['Time employed',tenure(profile.startDate,profile.today)],['Employment type',employmentLabel(profile.employmentType)],['Shift',profile.shift]];
  const facts=items=><dl className="profile-facts">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>;
  return <section className="stack portal-profile-page">
    <h1>My profile</h1>
    <header className="card employee-profile-hero">
      <div className="employee-profile-avatar" aria-hidden="true">{initials(profile.fullName)}</div>
      <div className="employee-profile-identity">
        <h2>{profile.fullName}</h2>
        <p className="employee-profile-role">{profile.position || 'Position not assigned'}</p>
        <div className="row"><span className="muted">{profile.department || 'Department not assigned'}</span><Badge tone={profile.status==='active'?'ok':'neutral'}>{profile.status==='active'?'Active':profile.status==='inactive'?'Inactive':profile.status}</Badge></div>
        <small className="muted">Employee ID · {profile.employeeCode}</small>
      </div>
    </header>
    <div className="employee-profile-grid">
      <section className="card stack employee-profile-section"><h2><ContactRound size={18} aria-hidden="true"/>Account &amp; contact</h2>{facts(contact)}</section>
      <section className="card stack employee-profile-section"><h2><Briefcase size={18} aria-hidden="true"/>Employment</h2>{facts(employment)}</section>
    </div>
    <section className="card stack employee-profile-section"><div className="row between"><h2>Experience</h2>{!editing&&<Button size="sm" onClick={onEdit}><Pencil size={14} aria-hidden="true"/>{profile.experienceSummary?'Edit':'Add'}</Button>}</div>
      {editing?<form className="stack" onSubmit={onSave}>
        <Field as="textarea" label="Experience summary" value={summary} maxLength={5000} rows={4} placeholder="Previous employers, roles and dates" disabled={busy} onChange={e=>onSummaryChange(e.target.value)}/>
        <small className="muted">{summary.length}/5000</small>
        {saveError&&<p role="alert" className="form-error">{saveError}</p>}
        <div className="row end"><Button disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save experience</Button></div>
      </form>:<p className="profile-summary">{profile.experienceSummary || 'No experience added.'}</p>}
    </section>
    <section className="card stack employee-profile-section" aria-busy={history.loading || undefined}>
      <h2><History size={18} aria-hidden="true"/>Position history</h2>
      {history.error?<p className="form-error" role="alert">{history.error} <Button size="sm" onClick={onRetry}>Retry</Button></p>:history.loading&&!history.items.length?<Skeleton variant="cards" label="Loading position history…"/>:!history.items.length?<p className="muted">No position history recorded yet.</p>:<>
        <ol className="employee-profile-timeline">{history.items.map(item=><li key={item.id}>
          <div className="row between"><strong>{item.position || 'Position not assigned'}</strong><time className="muted" dateTime={item.recordedOn}>{formatWorkDate(item.recordedOn)}</time></div>
          <span className="muted">{item.department || 'Department not assigned'}</span>
          <small className="muted">{item.baseline?'Starting record':'Assignment update'}</small>
        </li>)}</ol>
        <small className="muted">Recorded dates reflect tracking, not appointment dates.</small>
      </>}
      {history.total>SIZE&&<Pager page={page} pageSize={SIZE} total={history.total} onPage={onPage} disabled={history.loading}/>}
    </section>
    <small className="muted">Contact HR to update your personal or employment details.</small>
  </section>;
}
