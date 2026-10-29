import {useEffect,useState} from 'react';
import {useAuth} from '../api/auth.jsx';
import {get} from '../api/client.js';
import {formatMoney} from '../api/money.js';
import Button from './Button.jsx';
import Table,{Pager} from './Table.jsx';
const HR=['employee','department','position','salary_profile','attendance_record','leave_request','announcement'];
export default function AuditBar({type,id,reload=0}){
 const {user}=useAuth(),p=user?.permissions||[];
 const allowed=type==='access_employee'?p.includes('audit.access'):HR.includes(type)?p.includes('audit.hr'):p.includes('audit.hr')||p.includes('audit.finance');
 if(!id||!allowed)return null;
 return <History key={`${type}-${id}`} type={type} id={id} reload={reload}/>;
}
const stamp=value=>value?new Date(value).toLocaleString():'Not recorded';
const label=s=>s.replaceAll('_',' ').replace(/([a-z])([A-Z])/g,'$1 $2');
const value=(field,v)=>v==null?'—':field.endsWith('Minor')&&typeof v==='number'?formatMoney(v):Array.isArray(v)?v.join(', '):String(v);
function History({type,id,reload}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[data,setData]=useState({items:[],total:0,summary:{},loading:true,error:''});
 useEffect(()=>{
  const ctrl=new AbortController();setData(s=>({...s,loading:true,error:''}));
  get(`/audit-history/${type}/${id}`,{page,pageSize:10},{signal:ctrl.signal}).then(r=>{if(!ctrl.signal.aborted)setData({...r,loading:false,error:''});}).catch(e=>{if(!ctrl.signal.aborted)setData({items:[],total:0,summary:{},loading:false,error:e.message});});return()=>ctrl.abort();
 },[type,id,page,retry,reload]);
 return <aside className="card stack" aria-label="Record audit history">
  <strong>Audit information</strong>
  {data.loading?<p role="status">Loading audit history…</p>:data.error?<p role="alert" className="form-error">{data.error} <Button size="sm" onClick={()=>setRetry(n=>n+1)}>Retry</Button></p>:<>
   <dl className="profile-facts">{[['created','Created'],['modified','Last modified'],['approved','Approved']].map(([key,title])=><div key={key}><dt>{title} by / on</dt><dd>{data.summary[key]?`${data.summary[key].actor||'System / not recorded'} · ${stamp(data.summary[key].at)}`:'Not recorded'}</dd></div>)}</dl>
   <Button size="sm" aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)setRetry(n=>n+1);}}>{open?'Hide change log':'View change log'}</Button><Button size="sm" onClick={()=>setRetry(n=>n+1)}>Refresh audit</Button>
   {open&&<><Table caption="Record change log" columns={[{key:'actor',header:'By'},{key:'at',header:'On',render:r=>stamp(r.at)},{key:'action',header:'Action',render:r=>label(r.action)},
    {key:'changes',header:'Changes',render:r=>r.changes.length?<ul>{r.changes.map(c=><li key={c.field}>{label(c.field)}: {Object.hasOwn(c,'value')?value(c.field,c.value):`${value(c.field,c.from)} → ${value(c.field,c.to)}`}</li>)}</ul>:'No field values recorded'},
    {key:'reason',header:'Reason',render:r=>r.reason||'—'}]} rows={data.items} empty="No audit events recorded"/>
    <Pager page={page} pageSize={10} total={data.total} onPage={setPage} disabled={data.loading}/></>}
   <small className="muted">Only recorded events and permitted fields are shown. Older records may have incomplete history.</small>
  </>}
 </aside>;
}
