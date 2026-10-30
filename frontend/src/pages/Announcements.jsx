import {usePageRefresh} from '../api/pageRefresh.jsx';
import Skeleton from '../components/Skeleton.jsx';
import {usePermission} from '../api/auth.jsx';
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
  const pageRefresh = usePageRefresh();
  const [page,setPage]=useState(1),[reload,setReload]=useState(0);
  const [state,setState]=useState({items:[],total:0,loading:true,error:''});
  useEffect(()=>{
    const ctrl=new AbortController();setState(s=>({...s,loading:true,error:''}));
    get('/announcements',{page,pageSize:size,status:status || undefined},{signal:ctrl.signal})
      .then(r=>{if(!ctrl.signal.aborted)setState({...r,loading:false,error:''});})
      .catch(e=>{if(!ctrl.signal.aborted)setState({items:[],total:0,loading:false,error:e.message});});
    return()=>ctrl.abort();
  },[page,size,status,reload, pageRefresh]);
  return { ...state,page,setPage,refresh:()=>setReload(n=>n+1) };
}
export function AnnouncementFeed() {
  const data=useAnnouncements(5);
  return <section className="stack announcement-feed" aria-labelledby="employee-announcements-title">
    <div className="row between"><h2 id="employee-announcements-title">Announcements</h2></div>
    {data.loading && !data.items.length ? <Skeleton variant="cards" label="Loading announcements…" /> : data.error ? <p role="alert" className="form-error">{data.error}</p> : !data.total ? <p className="muted">No active announcements.</p>
      : data.items.map(item=><article className="announcement-feed-item" key={item.id}>
        <details><summary><strong>{item.title}</strong></summary><p>{item.body}</p></details>
        <small className="muted">Published {item.publishedAt}{item.expiresOn ? ` · Through ${item.expiresOn}` : ''}</small>
      </article>)}
    {data.total>5&&<Pager page={data.page} pageSize={5} total={data.total} onPage={data.setPage} disabled={data.loading} />}
  </section>;
}
export default function Announcements() {
  const canManage=usePermission('announcements.manage');
  const [status,setStatus]=useState(''),[editing,setEditing]=useState(null),[busy,setBusy]=useState(null);
  const data=useAnnouncements(10,status),toast=useToast();
  async function archive(item) {
    if(busy!==null)return;setBusy(item.id);
    try { await put(`/announcements/${item.id}`,payload({...item,status:'archived'}));toast.success('Announcement archived');data.refresh(); }
    catch(e){toast.error(e.message);data.refresh();}finally{setBusy(null);}
  }
  return <section className="stack announcements-page">
    <div className="row between posting-heading"><h1>Announcements</h1><div className="posting-controls"><Field as="select" hideLabel label="Status" placeholder="All statuses" options={OPTIONS} value={status} onChange={e=>{setStatus(e.target.value);data.setPage(1);}} />{canManage&&<Button size="sm" variant="primary" onClick={()=>setEditing({title:'',body:'',status:'draft',expiresOn:''})}>New announcement</Button>}</div></div>
    <Table caption="Company announcements" columns={[
      {key:'title',header:'Title',render:r=><details className="announcement-text"><summary style={{overflowWrap:'anywhere'}}>{r.title}</summary><p style={{whiteSpace:'pre-wrap'}}>{r.body}</p></details>},
      {key:'status',header:'Status',render:r=><Badge tone={r.status==='published'&&!r.expired?'ok':'neutral'}>{r.status==='published'&&r.expired?'Expired':r.status}</Badge>},
      {key:'publishedAt',header:'Published',render:r=>r.publishedAt || 'Not published'},
      {key:'expiresOn',header:'Visible through',render:r=>r.expiresOn || 'No expiry'},
      {key:'actions',header:'Actions',render:r=><div className="row"><Button size="sm" disabled={busy!==null} onClick={()=>setEditing(r)}>Edit</Button>{r.status!=='archived'&&<Button size="sm" busy={busy===r.id} disabled={busy!==null} onClick={()=>archive(r)}>Archive</Button>}</div>},
    ] .filter(c=>canManage||c.key!=='actions')} rows={data.items} loading={data.loading} error={data.error} onRetry={data.refresh} empty="No announcements found" />
    <Pager page={data.page} pageSize={10} total={data.total} onPage={data.setPage} disabled={data.loading} />
    {canManage&&editing&&<AnnouncementEditor key={editing.id || 'new'} item={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);data.refresh();}} onRefresh={data.refresh} />}
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
  return <Modal open wide title={item.id?'Edit announcement':'New announcement'} onClose={()=>!busy&&onClose()} footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" form="announcement-editor" type="submit" busy={busy} disabled={conflict}>{form.status==='published'?'Publish':'Save'}</Button></>}>
    <form id="announcement-editor" className="form-grid" onSubmit={submit}>
      {error&&<p role="alert" className="form-error full">{error}</p>}
      <Field className="full" label="Title" value={form.title} onChange={change('title')} required maxLength={160} disabled={busy||conflict} error={fields.title} autoFocus />
      <Field as="textarea" className="full" label="Message" value={form.body} onChange={change('body')} required rows={4} maxLength={5000} disabled={busy||conflict} error={fields.body} hint={`${form.body.length}/5000`} />
      <Field as="select" label="Status" options={OPTIONS} value={form.status} onChange={change('status')} disabled={busy||conflict} error={fields.status} />
      <Field type="date" label="Expiry (optional)" value={form.expiresOn} onChange={change('expiresOn')} disabled={busy||conflict} error={fields.expiresOn} />
    </form>
  </Modal>;
}
