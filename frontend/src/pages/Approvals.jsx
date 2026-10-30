import {usePageRefresh} from '../api/pageRefresh.jsx';
import {useEffect,useState} from 'react';
import {get,post} from '../api/client.js';
import {useAuth} from '../api/auth.jsx';
import {changeLabel,fieldLabel} from '../api/approvalLabels.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table,{Badge,Pager} from '../components/Table.jsx';

function ProposedValues({value,depth=0}){
 if(value===null||typeof value!=='object')return <span className="approval-value">{value===null?'None':typeof value==='boolean'?(value?'Yes':'No'):String(value)}</span>;
 const entries=Object.entries(value);
 if(!entries.length)return <span className="muted">{Array.isArray(value)?'No items':'No fields'}</span>;
 const fields=<dl className="approval-values">{entries.map(([key,item])=><div key={key}><dt>{Array.isArray(value)?`Row ${Number(key)+1}`:fieldLabel(key)}</dt><dd><ProposedValues value={item} depth={depth+1}/></dd></div>)}</dl>;
 return depth>0?<details className="approval-nested"><summary>{entries.length} {Array.isArray(value)?'items':'fields'}</summary>{fields}</details>:fields;
}
const when=value=>value?new Date(value).toLocaleString():'—';
const statusTone=status=>status==='pending'?'warn':status==='approved'?'ok':status==='rejected'?'danger':'neutral';
export default function Approvals(){
 const pageRefresh=usePageRefresh(),{user}=useAuth();
 const [loading,setLoading]=useState(true);
 const [view,setView]=useState('pending'),[page,setPage]=useState(1),[data,setData]=useState(null),[selected,setSelected]=useState(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),[notice,setNotice]=useState('');
 useEffect(()=>{
  const ctrl=new AbortController();setLoading(true);setError('');setSelected(null);
  get('/change-requests',{view,page},{signal:ctrl.signal}).then(r=>{if(!ctrl.signal.aborted)setData(r);}).catch(e=>{if(!ctrl.signal.aborted){setData(null);setError(e.message);}}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return ()=>ctrl.abort();
 },[view,page,version,pageRefresh]);
 const decide=async action=>{
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{const r=await post(`/change-requests/${selected.id}/${action}`,{reason});setNotice(`Request #${r.id}: ${r.status}.`);setSelected(null);setReason('');setVersion(v=>v+1);}
  catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const columns=[
  {key:'id',header:'Request',render:r=>`#${r.id}`},
  {key:'department',header:'Area',render:r=>r.department.toUpperCase()},
  {key:'change',header:'Change',render:r=>changeLabel(r.method,r.path)},
  {key:'requester_name',header:'Requested by',render:r=><>{r.requester_name}{Number(r.requester_id)===user.id?' (you)':''}</>},
  {key:'requested_at',header:'Requested on',render:r=>when(r.requested_at)},
  {key:'status',header:'Status',render:r=><Badge tone={statusTone(r.status)}>{r.status}</Badge>},
  {key:'review',header:'Review',render:r=><Button size="sm" disabled={busy||loading} onClick={()=>{setSelected(r);setReason('');setError('');}}>Details</Button>},
 ];
 return <section className="stack approvals-page">
  <div className="row between approval-heading"><h1>Approvals</h1><Field as="select" hideLabel label="Request view" value={view} onChange={e=>{setView(e.target.value);setPage(1);}} disabled={busy} options={[{value:'pending',label:'Pending'},{value:'mine',label:'My requests'},{value:'all',label:'All requests'}]}/></div>
  {notice&&<p role="status">{notice}</p>}
  <Table caption="Change requests" columns={columns} rows={data?.items??[]} loading={loading} error={!selected?error:''} onRetry={()=>setVersion(v=>v+1)} empty="No requests found."/>
  {data&&<Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} disabled={busy||loading}/>}
  {selected&&<Modal open wide title={`Request #${selected.id}`} dismissible={!busy} onClose={()=>!busy&&setSelected(null)} footer={<>
   {selected.canReview&&<><Button variant="primary" busy={busy} onClick={()=>decide('approve')}>Approve and apply</Button><Button variant="danger" disabled={busy||!reason.trim()} onClick={()=>decide('reject')}>Reject</Button></>}
   {selected.canCancel&&<Button disabled={busy} onClick={()=>decide('cancel')}>Withdraw request</Button>}
   <Button disabled={busy} onClick={()=>setSelected(null)}>Close</Button>
  </>}><div className="stack approval-detail">
   <div className="row between"><strong>{changeLabel(selected.method,selected.path)}</strong><Badge tone={statusTone(selected.status)}>{selected.status}</Badge></div>
   <dl className="approval-meta"><div><dt>Requested by</dt><dd>{selected.requester_name}</dd></div><div><dt>Requested on</dt><dd>{when(selected.requested_at)}</dd></div>
    {selected.reviewed_at&&<><div><dt>Reviewed by</dt><dd>{selected.reviewer_name}</dd></div><div><dt>Reviewed on</dt><dd>{when(selected.reviewed_at)}</dd></div></>}
   </dl>
   {selected.review_reason&&<p className="approval-value"><span className="muted">Review note: </span>{selected.review_reason}</p>}
   <section className="stack approval-proposal"><h3>Proposed changes</h3><ProposedValues value={selected.payload_preview}/></section>
   {error&&<p className="form-error" role="alert">{error}</p>}
   {(selected.canReview||selected.canCancel)&&<Field as="textarea" rows={2} label="Review note" hint={selected.canReview?'Required to reject.':undefined} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} disabled={busy}/>}
  </div></Modal>}
 </section>;
}
