import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../api/auth.jsx';
import Field from '../components/Field.jsx';
import Button from '../components/Button.jsx';
export default function ChangePassword({forced=false}) {
  const {changePassword,logout}=useAuth(),navigate=useNavigate();
  const [form,setForm]=useState({currentPassword:'',newPassword:'',confirmPassword:''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState({});
  const change=key=>e=>setForm(f=>({...f,[key]:e.target.value}));
  async function submit(e){
    e.preventDefault();if(busy)return;setError('');setFields({});
    if(form.newPassword!==form.confirmPassword){setFields({confirmPassword:'Passwords must match'});return;}
    if(form.newPassword.length<10){setFields({newPassword:'Use at least 10 characters'});return;}
    setBusy(true);
    try{await changePassword(form);if(!forced)navigate('/portal/profile',{replace:true});}
    catch(e){setError(e.message);setFields(e.fields || {});setForm(f=>({...f,currentPassword:''}));}
    finally{setBusy(false);}
  }
  const content=<form className={forced?'auth-card password-change-form':'stack password-change-form'} onSubmit={submit}>
    <h1>{forced?'Set your own password':'Change password'}</h1>
    <small className="muted">Other sessions will be signed out.</small>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <Field type="password" label={forced?'Temporary / current password':'Current password'} autoComplete="current-password" value={form.currentPassword} onChange={change('currentPassword')} required maxLength={256} disabled={busy} error={fields.currentPassword} autoFocus />
    <Field type="password" label="New password" autoComplete="new-password" value={form.newPassword} onChange={change('newPassword')} required minLength={10} maxLength={72} disabled={busy} error={fields.newPassword} hint="10+ characters, maximum 72 UTF-8 bytes." />
    <Field type="password" label="Confirm new password" autoComplete="new-password" value={form.confirmPassword} onChange={change('confirmPassword')} required disabled={busy} error={fields.confirmPassword} />
    <div className="row end password-actions">{forced?<Button disabled={busy} onClick={logout}>Log out</Button>:<Button disabled={busy} onClick={()=>navigate('/portal/profile')}>Cancel</Button>}<Button variant="primary" type="submit" busy={busy}>Save password</Button></div>
  </form>;
  return forced?<main className="auth-page">{content}</main>:<section className="stack">{content}</section>;
}
