import {useEffect,useState,useRef} from 'react';
import {get,post} from '../api/client.js';
import {useAuth} from '../api/auth.jsx';
import {changeLabel,fieldLabel} from '../api/approvalLabels.js';
function ProposedValues({value}){
 if(value===null||typeof value!=='object')return <span>{value===null?'None':typeof value==='boolean'?(value?'Yes':'No'):String(value)}</span>;
 return <dl>{Object.entries(value).map(([key,item])=><div key={key}><dt><strong>{Array.isArray(value)?`Row ${Number(key)+1}`:fieldLabel(key)}</strong></dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><ProposedValues value={item}/></dd></div>)}</dl>;
}
const when=value=>value?new Date(value).toLocaleString():'—';
export default function Approvals(){
 const {user}=useAuth(),detailRef=useRef(null);
 const [view,setView]=useState('pending'),[page,setPage]=useState(1),[data,setData]=useState(null),[selected,setSelected]=useState(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),[notice,setNotice]=useState('');
 useEffect(()=>{
  const ctrl=new AbortController();setData(null);setError('');setSelected(null);
  get('/change-requests',{view,page},{signal:ctrl.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
  return ()=>ctrl.abort();
 },[view,page,version]);
 useEffect(()=>{if(selected){detailRef.current?.focus();}},[selected]);
 const decide=async action=>{
  setBusy(true);setError('');setNotice('');
  try {const r=await post(`/change-requests/${selected.id}/${action}`,{reason});setNotice(`Request #${r.id}: ${r.status}.`);setSelected(null);setReason('');setVersion(v=>v+1);}
  catch(e){setError(e.message);}finally{setBusy(false);}
 };
 return <section><h1>Approvals</h1><p className="muted">HR and Finance administrative changes take effect after another authorized person in the same area, or Admin, approves. Admin changes apply immediately. Attendance check-ins and existing leave approvals continue as usual.</p>
  <div className="toolbar"><label>Show <select value={view} onChange={e=>{setView(e.target.value);setPage(1);}} disabled={busy}><option value="pending">Pending</option><option value="mine">My requests</option><option value="all">All requests</option></select></label><button onClick={()=>setVersion(v=>v+1)} disabled={busy}>Refresh</button></div>
  {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!data?<p aria-busy="true">Loading requests…</p>:<><div className="table-wrap"><table><thead><tr><th>Request</th><th>Area</th><th>Change</th><th>Requested by</th><th>Requested on</th><th>Status</th><th>Review</th></tr></thead><tbody>
  {data.items.map(row=><tr key={row.id}><td>#{row.id}</td><td>{row.department.toUpperCase()}</td><td>{changeLabel(row.method,row.path)}</td><td>{row.requester_name}{Number(row.requester_id)===user.id?' (you)':''}</td><td>{when(row.requested_at)}</td><td>{row.status}</td><td><button disabled={busy} onClick={()=>{setSelected(row);setReason('');setError('');}}>Details</button></td></tr>)}
  {!data.items.length&&<tr><td colSpan={7}>No requests found.</td></tr>}</tbody></table></div>
  <div className="toolbar"><button disabled={busy||page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(data.total/data.pageSize))} · {data.total} requests</span><button disabled={busy||page*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Next</button></div></>}
  {selected&&<article className="card" ref={detailRef} tabIndex={-1} aria-label={`Request ${selected.id} details`}><h2>Request #{selected.id}</h2><p>{changeLabel(selected.method,selected.path)} · {selected.status}</p><p>Requested by {selected.requester_name} on {when(selected.requested_at)}</p>
   <p>Proposed values (protected credentials are hidden):</p><ProposedValues value={selected.payload_preview}/>
   {selected.reviewed_at&&<p>{selected.status} by {selected.reviewer_name} on {when(selected.reviewed_at)}{selected.review_reason?`: ${selected.review_reason}`:''}</p>}
   {(selected.canReview||selected.canCancel)&&<><label>Review note (required to reject)<textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} disabled={busy}/></label><div className="toolbar">
    {selected.canReview&&<><button disabled={busy} onClick={()=>decide('approve')}>Approve and apply</button><button disabled={busy||!reason.trim()} onClick={()=>decide('reject')}>Reject</button></>}
    {selected.canCancel&&<button disabled={busy} onClick={()=>decide('cancel')}>Withdraw request</button>}</div></>}
   {!selected.canReview&&selected.canCancel&&<p className="muted">A different authorized person must approve your change.</p>}<button disabled={busy} onClick={()=>setSelected(null)}>Close details</button>
  </article>}
 </section>;
}
