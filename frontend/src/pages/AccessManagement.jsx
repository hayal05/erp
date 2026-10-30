import {usePageRefresh} from '../api/pageRefresh.jsx';
import {useEffect,useState} from 'react';
import {usePermission,useAuth} from '../api/auth.jsx';
import {get,post} from '../api/client.js';
import {useToast} from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table,{Pager} from '../components/Table.jsx';
const SIZE=15,HISTORY_SIZE=10;
const roleName=role=>({hr:'HR',finance:'Finance',admin:'Admin'}[role]||role);
const stamp=value=>value?new Date(value).toLocaleString():'—';
export default function AccessManagement(){
 const {user}=useAuth();
 if(!user?.permissions?.includes('access.read'))return <section><h1>Access Management</h1><p role="alert">You do not have access to this page.</p></section>;
 return <AccessList />;
}
function AccessList(){
  const pageRefresh = usePageRefresh();
 const canManage=usePermission('access.manage');
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[reload,setReload]=useState(0),[selected,setSelected]=useState(null);
 const [data,setData]=useState({items:[],total:0,loading:true,error:''});const refresh=()=>setReload(n=>n+1);
 useEffect(()=>{
  const ctrl=new AbortController();setData(d=>({...d,loading:true,error:''}));
  get('/access-management/employees',{page,pageSize:SIZE,search:query},{signal:ctrl.signal})
   .then(r=>{if(!ctrl.signal.aborted)setData({...r,loading:false,error:''});})
   .catch(e=>{if(!ctrl.signal.aborted)setData({items:[],total:0,loading:false,error:e.message});});return()=>ctrl.abort();
 },[page,query,reload, pageRefresh]);
 return <section className="stack access-management-page"><h1>Access Management</h1>
  <form className="row" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);}}><Field label="Name, username, email or ID" value={search} maxLength={120} onChange={e=>setSearch(e.target.value)} /><Button type="submit">Search</Button></form>
  <Table caption="Employee access" columns={[
   {key:'employeeCode',header:'Employee ID'},{key:'fullName',header:'Name'},{key:'username',header:'Username'},{key:'department',header:'Department'},{key:'position',header:'Position'},
   {key:'active',header:'Account',render:r=>r.active?'Active':'Inactive'},
   {key:'accessRoles',header:'Additional access',render:r=>r.accessRoles.map(roleName).join(', ')||'Employee only'},
   {key:'actions',header:'Actions',render:r=><Button size="sm" onClick={()=>setSelected(r)}>{canManage?'Manage access':'View access'}</Button>},
  ]} rows={data.items} loading={data.loading} error={data.error} onRetry={refresh} empty="No registered employees found" />
  <Pager page={page} pageSize={SIZE} total={data.total} onPage={setPage} disabled={data.loading}/>
  {selected&&<AccessDialog key={selected.id} employee={selected} onClose={()=>setSelected(null)} onChanged={refresh}/>}
 </section>;
}
function AccessDialog({employee,onClose,onChanged}){
  const pageRefresh = usePageRefresh();
 const canManage=usePermission('access.manage');
 const [page,setPage]=useState(1),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revoke,setRevoke]=useState(null),[reason,setReason]=useState(''),[role,setRole]=useState('hr');
 const [history,setHistory]=useState({items:[],total:0,loading:true,error:''}),[active,setActive]=useState(employee.accessRoles);const toast=useToast();
 const refresh=()=>setReload(n=>n+1);
 useEffect(()=>{
  const ctrl=new AbortController();setHistory(h=>({...h,loading:true,error:''}));
  get(`/access-management/employees/${employee.id}/history`,{page,pageSize:HISTORY_SIZE},{signal:ctrl.signal}).then(r=>{if(!ctrl.signal.aborted){setHistory({...r,loading:false,error:''});setActive(r.accessRoles);}})
   .catch(e=>{if(!ctrl.signal.aborted)setHistory({items:[],total:0,loading:false,error:e.message});});return()=>ctrl.abort();
 },[employee.id,page,reload, pageRefresh]);
 async function grant(e){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try{await post(`/access-management/employees/${employee.id}/grants`,{role});setActive(a=>[...new Set([...a,role])]);setPage(1);refresh();onChanged();toast.success(`${roleName(role)} access granted`);}
  catch(e){setError(e.message);refresh();}finally{setBusy(false);}
 }
 async function remove(e){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try{await post(`/access-management/employees/${employee.id}/grants/${revoke.id}/revoke`,{reason});setActive(a=>a.filter(r=>r!==revoke.role));setRevoke(null);setReason('');refresh();onChanged();toast.success('Access revoked');}
  catch(e){setError(e.message);refresh();}finally{setBusy(false);}
 }
 return <Modal open wide title={`Access · ${employee.fullName}`} dismissible={!busy} onClose={()=>!busy&&onClose()} footer={<Button disabled={busy} onClick={onClose}>Close</Button>}><div className="stack">
  <p>{employee.employeeCode} · {employee.username}</p><p>Additional access: <strong>{active.map(roleName).join(', ')||'None'}</strong></p>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {canManage&&(!employee.active?<p className="muted">Activate the employee to grant access.</p>:<form className="stack" onSubmit={grant}>
   <Field as="select" label="Grant additional access" options={[{value:'hr',label:'HR'},{value:'finance',label:'Finance'}]} value={role} onChange={e=>setRole(e.target.value)} disabled={busy}/>
   <Button type="submit" variant="primary" busy={busy} disabled={active.includes(role)}>Grant {roleName(role)} access</Button>
  </form>)}
  {canManage&&revoke&&<form className="card stack" onSubmit={remove}><h3>Revoke {roleName(revoke.role)} access?</h3><Field as="textarea" label="Reason" required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/><div className="row"><Button disabled={busy} onClick={()=>setRevoke(null)}>Cancel</Button><Button type="submit" variant="danger" busy={busy}>Revoke access</Button></div></form>}
  <h2>Access history</h2>
  <Table caption="Grant and revocation history" columns={[
   {key:'role',header:'Access',render:r=>roleName(r.role)},{key:'grantedBy',header:'Granted by'},{key:'grantedAt',header:'Granted on',render:r=>stamp(r.grantedAt)},
   {key:'revokedBy',header:'Revoked by',render:r=>r.revokedBy||'—'},{key:'revokedAt',header:'Revoked on',render:r=>stamp(r.revokedAt)},{key:'revokeReason',header:'Reason'},
   {key:'actions',header:'Status',render:r=>r.revokedAt?'Revoked':r.role==='admin'?'Active (protected)':!canManage?'Active':<Button size="sm" disabled={busy} onClick={()=>{setRevoke(r);setReason('');setError('');}}>Revoke {roleName(r.role)}</Button>},
  ]} rows={history.items} loading={history.loading} error={history.error} onRetry={refresh} empty="No access grants recorded"/>
  <Pager page={page} pageSize={HISTORY_SIZE} total={history.total} onPage={setPage} disabled={history.loading||busy}/>
 </div></Modal>;
}
