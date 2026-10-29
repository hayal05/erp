import {useEffect,useId,useRef,useState} from 'react';
import {History} from 'lucide-react';
import {get} from '../api/client.js';
import {useAuth} from '../api/auth.jsx';
import {auditLabel} from '../api/auditScope.js';
import {formatMoney} from '../api/money.js';
import Button from './Button.jsx';
import Table,{Pager} from './Table.jsx';
const stamp=value=>value?new Intl.DateTimeFormat(undefined,{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'—';
const value=(field,v)=>v==null?'—':field.endsWith('Minor')&&typeof v==='number'?formatMoney(v):Array.isArray(v)?v.join(', '):String(v);
function AuditFact({title,event,unapproved=false,loading,error}){
 const text=event?`${event.actor||'System / not recorded'} · ${stamp(event.at)}`:'';
 return <div><dt>{title}:</dt><dd title={error||text||undefined}>{error?<span role="alert">Unavailable</span>:loading?'…':event?<><span className="audit-actor">{event.actor||'System / not recorded'}</span><span aria-hidden="true">·</span><time dateTime={event.at}>{stamp(event.at)}</time></>:unapproved?<span className="audit-not-authorised">Not authorised</span>:'—'}</dd></div>;
}
export default function AuditBottomBar({scope}){
 const {user}=useAuth();
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const ref=useRef(null),panel=useRef(null),toggle=useRef(null),panelId=useId();
 const permissions=(user?.permissions??[]).join('|');
 useEffect(()=>{
  const ctrl=new AbortController();setBusy(true);setError('');
  get('/audit-history',{area:scope.area,page,pageSize:10},{signal:ctrl.signal}).then(r=>{if(!ctrl.signal.aborted)setData(r);}).catch(e=>{if(!ctrl.signal.aborted){setData(null);setError(e.status===403?'Audit history is unavailable for this section.':e.message);}}).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
  return()=>ctrl.abort();
 },[scope.area,page,retry,permissions]);
 // Reserve exactly the displayed height so the fixed footer never covers the last table row.
 useEffect(()=>{
  const footer=ref.current,shell=footer?.closest('.hr-shell');if(!footer||!shell)return undefined;
  const resize=()=>shell.style.setProperty('--audit-bar-height',`${Math.ceil(footer.getBoundingClientRect().height)}px`);
  resize();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resize);observer?.observe(footer);
  return()=>{observer?.disconnect();shell.style.removeProperty('--audit-bar-height');};
 },[]);
 useEffect(()=>{if(open)panel.current?.focus();},[open]);
 const close=()=>{setOpen(false);toggle.current?.focus();};
 return <footer ref={ref} className="audit-bottom-bar" aria-label="Audit bottom bar" onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();close();}}}>
  {open&&<section ref={panel} id={panelId} className="audit-bottom-log stack" tabIndex={-1} aria-label={`${scope.label} change log`}>
   <div className="row between"><h2>{scope.label} change log</h2><Button size="sm" onClick={close}>Close change log</Button></div>
   <Table caption={`${scope.label} audit events`} loading={busy} error={error} onRetry={()=>setRetry(n=>n+1)} rows={data?.items??[]} empty="No recorded activity in this section" columns={[
    {key:'actor',header:'By'},{key:'at',header:'On',render:r=>stamp(r.at)},{key:'record',header:'Record',render:r=>`${auditLabel(r.type)}${r.recordId?` #${r.recordId}`:''}`},
    {key:'action',header:'Action',render:r=>auditLabel(r.action)},
    {key:'changes',header:'Changes',render:r=>r.changes.length?<ul>{r.changes.map(c=><li key={c.field}>{auditLabel(c.field)}: {Object.hasOwn(c,'value')?value(c.field,c.value):`${value(c.field,c.from)} → ${value(c.field,c.to)}`}</li>)}</ul>:'No field values recorded'},
    {key:'reason',header:'Reason',render:r=>r.reason||'—'}]}/>
   <Pager page={page} pageSize={10} total={data?.total??0} onPage={setPage} disabled={busy}/>
  </section>}
  <div className="audit-bottom-summary">
   <dl className="audit-bottom-facts" aria-busy={busy||undefined}>
    <AuditFact title="Modified by" event={data?.summary.modified} loading={!data&&!error} error={error}/>
    <AuditFact title="Approved by" event={data?.summary.approved} unapproved={!!data?.summary.modified && !data?.summary.approved} loading={!data&&!error} error={error}/>
   </dl>
   <button type="button" className="audit-log-toggle" ref={toggle} title="Change log" aria-label={open?'Close change log':'Open change log'} aria-expanded={open} aria-controls={open?panelId:undefined} onClick={()=>{if(open)close();else setOpen(true);}}><History size={15} aria-hidden="true"/><span className="audit-log-label">Change log</span></button>
  </div>
 </footer>;
}
