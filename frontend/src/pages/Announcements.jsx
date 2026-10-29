import AuditBar from '../components/AuditBar.jsx';
import { useEffect, useState } from 'react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Badge, Pager } from '../components/Table.jsx';
import { get, post, put } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
const OPTIONS = [{value:'draft',label:'Draft'},{value:'published',label:'Published'},{value:'archived',label:'Archived'}];
const payload = item => ({ title:item.title, body:item.body, status:item.status, expiresOn:item.expiresOn || null, ...(item.id ? {version:item.version} : {}) });
function useAnnouncements(size, status) {
  const [page,setPage]=useState(1),[reload,setReload]=useState(0);
  const [state,setState]=useState({items:[],total:0,loading:true,error:''});
  useEffect(()=>{
    const ctrl=new AbortController();setState(s=>({...s,loading:true,error:''}));
    get('/announcements',{page,pageSize:size,status:status || undefined},{signal:ctrl.signal})
      .then(r=>{if(!ctrl.signal.aborted)setState({...r,loading:false,error:''});})
      .catch(e=>{if(!ctrl.signal.aborted)setState({items:[],total:0,loading:false,error:e.message});});
    return()=>ctrl.abort();
  },[page,size,status,reload]);
  return { ...state,page,setPage,refresh:()=>setReload(n=>n+1) };
}
export function AnnouncementFeed() {
  const data=useAnnouncements(5);
  return <section className="card stack" aria-labelledby="employee-announcements-title">
    <div className="row between"><h2 id="employee-announcements-title">Announcements</h2><Button size="sm" onClick={data.refresh} disabled={data.loading}>Refresh</Button></div>
    {data.loading ? <p role="status">Loading announcements…</p> : data.error ? <p role="alert" className="form-error">{data.error}</p> : !data.total ? <p className="muted">No active announcements.</p>
      : data.items.map(item=><article className="card stack" key={item.id}>
        <h3 style={{overflowWrap:'anywhere'}}>{item.title}</h3>
        <small className="muted">Published {item.publishedAt}{item.expiresOn ? ` · Visible through ${item.expiresOn}` : ''}</small>
        <details><summary>Read announcement</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.body}</p></details>
      </article>)}
    <Pager page={data.page} pageSize={5} total={data.total} onPage={data.setPage} disabled={data.loading} />
  </section>;
}
export default function Announcements() {
  const [status,setStatus]=useState(''),[editing,setEditing]=useState(null),[busy,setBusy]=useState(null);
  const data=useAnnouncements(10,status),toast=useToast();
  async function archive(item) {
    if(busy!==null)return;setBusy(item.id);
    try { await put(`/announcements/${item.id}`,payload({...item,status:'archived'}));toast.success('Announcement archived');data.refresh(); }
    catch(e){toast.error(e.message);data.refresh();}finally{setBusy(null);}
  }
  return <section className="stack">
    <div className="row between"><h1>Announcements</h1><Button variant="primary" onClick={()=>setEditing({title:'',body:'',status:'draft',expiresOn:''})}>New announcement</Button></div>
    <div className="row"><Field as="select" label="Status" placeholder="All statuses" options={OPTIONS} value={status} onChange={e=>{setStatus(e.target.value);data.setPage(1);}} /><Button onClick={data.refresh} disabled={data.loading}>Refresh</Button></div>
    <Table caption="Company announcements" columns={[
      {key:'title',header:'Title',render:r=><strong style={{overflowWrap:'anywhere'}}>{r.title}</strong>},
      {key:'status',header:'Status',render:r=><Badge tone={r.status==='published'&&!r.expired?'ok':'neutral'}>{r.status==='published'&&r.expired?'Expired':r.status}</Badge>},
      {key:'publishedAt',header:'Published',render:r=>r.publishedAt || 'Not published'},
      {key:'expiresOn',header:'Visible through',render:r=>r.expiresOn || 'No expiry'},
      {key:'actions',header:'Actions',render:r=><div className="row"><Button size="sm" disabled={busy!==null} onClick={()=>setEditing(r)}>Edit</Button>{r.status!=='archived'&&<Button size="sm" busy={busy===r.id} disabled={busy!==null} onClick={()=>archive(r)}>Archive</Button>}</div>},
    ]} rows={data.items} loading={data.loading} error={data.error} onRetry={data.refresh} empty="No announcements found" />
    <Pager page={data.page} pageSize={10} total={data.total} onPage={data.setPage} disabled={data.loading} />
    {editing&&<AnnouncementEditor key={editing.id || 'new'} item={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);data.refresh();}} onRefresh={data.refresh} />}
  </section>;
}
function AnnouncementEditor({item,onClose,onSaved,onRefresh}) {
  const [form,setForm]=useState({...item,expiresOn:item.expiresOn || ''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState({}),[conflict,setConflict]=useState(false);
  const toast=useToast();
  const change=key=>e=>{setForm(f=>({...f,[key]:e.target.value}));setFields(f=>({...f,[key]:undefined}));};
  async function submit(e){
    e.preventDefault();if(busy||conflict)return;setBusy(true);setError('');setFields({});
    try{
      if(item.id)await put(`/announcements/${item.id}`,payload(form));else await post('/announcements',payload(form));
      toast.success(form.status==='published'?'Announcement published':'Announcement saved');onSaved();
    }catch(e){setError(e.message);setFields(e.fields || {});if(e.status===409){setConflict(true);onRefresh();}}finally{setBusy(false);}
  }
  return <Modal open wide title={item.id?'Edit announcement':'New announcement'} onClose={()=>!busy&&onClose()} footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" form="announcement-editor" type="submit" busy={busy} disabled={conflict}>{form.status==='published'?'Publish announcement':'Save announcement'}</Button></>}>
    <form id="announcement-editor" className="stack" onSubmit={submit}>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <Field label="Title" value={form.title} onChange={change('title')} required maxLength={160} disabled={busy||conflict} error={fields.title} autoFocus />
      <Field as="textarea" label="Message" value={form.body} onChange={change('body')} required rows={8} maxLength={5000} disabled={busy||conflict} error={fields.body} hint={`${form.body.length}/5000`} />
      <Field as="select" label="Status" options={OPTIONS} value={form.status} onChange={change('status')} disabled={busy||conflict} error={fields.status} />
      <Field type="date" label="Visible through (optional)" value={form.expiresOn} onChange={change('expiresOn')} disabled={busy||conflict} error={fields.expiresOn} hint="Leave blank for no expiry." />
    </form>
    {item.id && <AuditBar type="announcement" id={item.id}/>}
  </Modal>;
}
