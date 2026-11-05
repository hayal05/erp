import {useEffect,useState} from 'react';
import {get,post,put} from '../api/client.js';
import {useResource,ResourceState} from './payrollResource.jsx';
import {ACTIVITY_GROUPS,SCOPED_ACTIVITIES,expandActivities,activityScopePlan} from '../../../shared/accessActivities.mjs';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table,{Badge,Pager} from '../components/Table.jsx';
import {useToast} from '../components/Toast.jsx';
export default function CustomAccessRoles(){
 const r=useResource('/custom-access/roles'),[editing,setEditing]=useState(null);
 return <section className="stack"><div className="row between"><h1>Custom access roles</h1><Button size="sm" variant="primary" onClick={()=>setEditing({name:'',activities:[]})}>New role</Button></div>
  <Table caption="Custom access roles" rows={r.data?.items??[]} loading={r.loading} error={r.error} onRetry={r.reload} empty="No custom roles" columns={[
   {key:'name',header:'Role'},{key:'activities',header:'Activities',render:r=>r.activities.length},{key:'scope',header:'Available scope',render:r=>activityScopePlan(r.activities,'departments').permissions.length?'All, departments or employees':'Company-wide only'},
   {key:'edit',header:'Actions',render:r=><Button size="sm" onClick={()=>setEditing(r)}>Edit role</Button>}
  ]}/>
  {editing&&<RoleEditor key={editing.id??'new'} role={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);r.reload();}}/>}
 </section>;
}
export function RoleEditor({role,onClose,onSaved}){
 const [name,setName]=useState(role.name),[activities,setActivities]=useState(role.activities),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const effective=expandActivities(activities),limited=effective.every(p=>SCOPED_ACTIVITIES.includes(p)),toast=useToast();
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const body={name,activities,...(role.id?{version:role.version}:{})};if(role.id)await put(`/custom-access/roles/${role.id}`,body);else await post('/custom-access/roles',body);toast.success('Access role saved');onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Modal open wide title={role.id?'Edit access role':'New access role'} onClose={()=>!busy&&onClose()} footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" form="custom-role-form" variant="primary" busy={busy} disabled={!activities.length}>Save role</Button></>}>
  <form id="custom-role-form" className="stack" onSubmit={save}>
   <Field label="Role name" value={name} required maxLength={80} autoFocus onChange={e=>setName(e.target.value)} disabled={busy}/>
   <small className="muted">{limited?'Supports department and employee scopes.':'Department assignments include scoped activities only; company-wide activities are excluded.'} Required viewing and inbox access is included automatically. Approval also requires the corresponding activity.</small>
   <div className="access-activity-grid">{ACTIVITY_GROUPS.map(([title,items])=><fieldset key={title}><legend>{title}</legend>{items.map(([id,label])=>{
    const checked=activities.includes(id),required=!checked&&effective.includes(id);
    return <label className="access-activity" key={id}><input type="checkbox" checked={checked||required} disabled={busy||required} onChange={e=>setActivities(a=>e.target.checked?[...a,id]:a.filter(p=>p!==id))}/><span>{label}{!expandActivities([id]).every(p=>SCOPED_ACTIVITIES.includes(p))&&<small className="muted"> · Company-wide</small>}{required&&<small className="muted"> · Required</small>}</span></label>;
   })}</fieldset>)}</div>
   {error&&<p className="form-error" role="alert">{error}</p>}
  </form>
 </Modal>;
}
function ScopePicker({type,selected,onChange}){
 const [search,setSearch]=useState(''),[matches,setMatches]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const ctrl=new AbortController();setBusy(true);get(type==='departments'?'/departments':'/employees',{pageSize:100},{signal:ctrl.signal}).then(r=>setMatches(r.items)).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});return()=>ctrl.abort();},[type]);
 async function find(e){e.preventDefault();setBusy(true);setError('');try{const r=await get(type==='departments'?'/departments':'/employees',{search,pageSize:100});setMatches(r.items);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <div className="stack"><div className="row"><Field type="search" label={`Find ${type}`} placeholder={`Find ${type} by name or ID`} value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')find(e);}}/><Button size="sm" busy={busy} onClick={find}>Find</Button></div>
  <div className="access-selected">{selected.map(item=><Button size="sm" key={item.id} onClick={()=>onChange(selected.filter(i=>i.id!==item.id))} aria-label={`Remove ${item.name}`}>{item.name} ×</Button>)}</div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  <div className="access-scope-results">{matches.map(item=>{const id=Number(item.id),name=item.name??`${item.fullName} · ${item.employeeCode}`,checked=selected.some(s=>s.id===id);return <label className="access-activity" key={id}><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked?[...selected,{id,name}]:selected.filter(s=>s.id!==id))}/>{name}</label>;})}</div>
 </div>;
}
export function CustomAssignments({employee,onChanged}){
 const [grantPage,setGrantPage]=useState(1);
 const roles=useResource('/custom-access/roles'),grants=useResource(`/custom-access/employees/${employee.id}/custom-grants`,{page:grantPage,pageSize:10});
 const [roleId,setRoleId]=useState(''),[scopeValue,setScopeValue]=useState('all'),[selected,setSelected]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revoking,setRevoking]=useState(null),[reason,setReason]=useState('');
 const scopeType=scopeValue.startsWith('department:')?'departments':scopeValue;
 const toast=useToast(),role=roles.data?.items.find(r=>String(r.id)===roleId),plan=activityScopePlan(role?.activities??[],scopeType);
 const refresh=()=>{grants.reload();onChanged?.();};
 async function grant(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await post(`/custom-access/employees/${employee.id}/custom-grants`,{roleId:Number(roleId),scopeType,departmentIds:scopeType==='departments'?selected.map(i=>i.id):[],employeeIds:scopeType==='employees'?selected.map(i=>i.id):[]});setGrantPage(1);refresh();toast.success('Custom access granted');}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function revoke(e){e.preventDefault();setBusy(true);setError('');try{await post(`/custom-access/employees/${employee.id}/custom-grants/${revoking.id}/revoke`,{reason});setRevoking(null);setReason('');refresh();toast.success('Custom access revoked');}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="stack custom-assignments"><h2>Custom access</h2><small className="muted">Access combines with existing grants.</small>
  {roles.error||grants.error?<ResourceState error={roles.error||grants.error} onRetry={()=>{roles.reload();grants.reload();}}/>:null}
  {employee.active&&<form className="stack" onSubmit={grant}>
   <div className="row"><Field as="select" label="Access role" placeholder="Choose role" options={(roles.data?.items??[]).map(r=>({value:r.id,label:r.name}))} value={roleId} disabled={busy} onChange={e=>{setRoleId(e.target.value);setScopeValue('all');setSelected([]);}}/>
   <ScopeSelection role={role} departments={roles.data?.departments??[]} value={scopeValue} busy={busy} onChange={e=>{const value=e.target.value;setScopeValue(value);const department=(roles.data?.departments??[]).find(d=>value===`department:${d.id}`);setSelected(department?[department]:[]);}}/></div>
   {(scopeValue==='departments'||scopeValue==='employees')&&<ScopePicker key={scopeType} type={scopeType} selected={selected} onChange={setSelected}/>}
   <div><Button size="sm" variant="primary" type="submit" busy={busy} disabled={!roleId||!plan.permissions.length||(scopeType!=='all'&&!selected.length)||(grants.data?.items??[]).some(g=>!g.revokedAt&&String(g.roleId)===roleId)}>Grant custom access</Button></div>
  </form>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {revoking&&<form className="stack" onSubmit={revoke}><Field label={`Reason to revoke ${revoking.name}`} required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/><div className="row"><Button size="sm" disabled={busy} onClick={()=>setRevoking(null)}>Cancel</Button><Button size="sm" type="submit" variant="danger" busy={busy}>Revoke</Button></div></form>}
  <Table caption="Custom access assignments" rows={grants.data?.items??[]} loading={grants.loading} columns={[
   {key:'name',header:'Role'},{key:'scopeType',header:'Scope',render:g=>g.scopeType==='all'?'All employees':g.scopeType==='departments'?(g.departmentNames?.join(', ')||'Selected departments'):(g.employeeNames?.join(', ')||'Selected employees')},
   {key:'status',header:'Status',render:g=>g.revokedAt?<Badge>Revoked</Badge>:<Button size="sm" disabled={busy} onClick={()=>{setRevoking(g);setReason('');}}>Revoke</Button>}
  ]}/>
  {(grants.data?.total>10||grantPage>1)&&<Pager page={grantPage} pageSize={10} total={grants.data?.total??0} onPage={setGrantPage} disabled={busy||grants.loading}/>}
 </section>;
}

export function ScopeSelection({role,departments=[],value,busy=false,onChange}){
 const scopeType=value.startsWith('department:')?'departments':value;
 const plan=activityScopePlan(role?.activities??[],scopeType),labels=Object.fromEntries(ACTIVITY_GROUPS.flatMap(([,items])=>items));
 return <div className="stack">
  <Field as="select" label="Access scope" value={value} disabled={busy||!role} onChange={onChange}
   hint={scopeType!=='all'&&role&&!plan.permissions.length?'This role has no employee-scoped activities. Edit the role to add them.':undefined}
   options={[{value:'all',label:'All employees'},...departments.map(d=>({value:`department:${d.id}`,label:d.name})),{value:'departments',label:'Multiple departments'},{value:'employees',label:'Selected employees'}]}/>
  {plan.excluded.length>0&&<small className="field-hint" role="status">Not granted for this scope: {plan.excluded.map(id=>labels[id]??id).join('; ')}.</small>}
 </div>;
}
