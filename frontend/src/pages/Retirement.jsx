import {useEffect,useState} from 'react';
import {usePermission} from '../api/auth.jsx';
import {put} from '../api/client.js';
import {useResource} from './payrollResource.jsx';
import Field from '../components/Field.jsx';
import Button from '../components/Button.jsx';
import Table,{Badge,Pager} from '../components/Table.jsx';
import {useToast} from '../components/Toast.jsx';
const statusOptions=[{value:'reached',label:'Retirement age reached'},{value:'within_year',label:'Within one year'},{value:'later',label:'More than one year'},{value:'missing_birth_date',label:'Missing birth date'},{value:'not_configured',label:'Age not set'}];
const labels=Object.fromEntries(statusOptions.map(o=>[o.value,o.label]));
function remainingTime(days){
 if(days==null||!Number.isFinite(days))return '—';
 if(days===0)return 'Today';
 const months=Math.round(Math.abs(days)*12/365.25),years=Math.floor(months/12),rest=months%12;
 const text=Math.abs(days)<365.25/12?'<1 month':`≈ ${years} ${years===1?'year':'years'} ${rest} ${rest===1?'month':'months'}`;
 return days<0?`${text} overdue`:text;
}
export function RetirementTable({items=[],loading=false,error='',onRetry}){
 return <Table caption="Employee retirement" columns={[
  {key:'employeeCode',header:'ID'},{key:'fullName',header:'Employee'},{key:'department',header:'Department',render:r=>r.department||'—'},
  {key:'position',header:'Position',render:r=>r.position||'—'},{key:'employmentStatus',header:'Employment',render:r=>r.employmentStatus==='active'?'Active':'Inactive'},
  {key:'dateOfBirth',header:'Birth date',render:r=>r.dateOfBirth||'—'},{key:'age',header:'Age',align:'num',render:r=>r.age??'—'},
  {key:'retirementDate',header:'Retirement date',render:r=>r.retirementDate||'—'},
  {key:'daysRemaining',header:'Time remaining',render:r=>remainingTime(r.daysRemaining)},
  {key:'status',header:'Status',render:r=><Badge tone={r.status==='reached'?'danger':r.status==='within_year'?'warn':'neutral'}>{labels[r.status]||r.status}</Badge>}
 ]} rows={items} loading={loading} error={error} onRetry={onRetry} empty="No employees found"/>;
}
export function RetirementAgeForm({settings,onSaved,disabled=false}){
 const [age,setAge]=useState(settings.retirementAge??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const toast=useToast();
 async function save(e){
  e.preventDefault();if(busy||disabled)return;setBusy(true);setError('');setNotice('');
  try{await put('/retirement/settings',{retirementAge:Number(age),version:settings.version});toast.success('Retirement age saved');onSaved();}
  catch(e){if(e.code==='approval_pending'){setNotice('Submitted for approval');onSaved();}else setError(e.message);}finally{setBusy(false);}
 }
 return <div><form className="retirement-age" onSubmit={save} aria-label="Retirement age settings">
  <Field label={settings.retirementAge===null?'Retirement age (not set)':'Retirement age'} type="number" min={18} max={100} step={1} required placeholder="Years" value={age} onChange={e=>setAge(e.target.value)} disabled={busy||disabled}/>
  <Button size="sm" type="submit" variant="primary" busy={busy} disabled={disabled||age===''||Number(age)===settings.retirementAge}>Save</Button>
 </form>{error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="muted" role="status">{notice}</p>}</div>;
}
export default function Retirement(){
 const canManage=usePermission('employees.manage');
 const [search,setSearch]=useState(''),[debounced,setDebounced]=useState(''),[status,setStatus]=useState(''),[employmentStatus,setEmploymentStatus]=useState('active'),[page,setPage]=useState(1);
 useEffect(()=>{const timer=setTimeout(()=>{setDebounced(search);setPage(1);},300);return()=>clearTimeout(timer);},[search]);
 const r=useResource('/retirement',{search:debounced,status,employmentStatus,page,pageSize:25});
 const d=r.data;
 return <section className="stack retirement-page">
  <div className="row between retirement-heading">
   <h1>Retirement</h1>
   {d&&<time className="muted" dateTime={d.today}>As of {d.today}</time>}
  </div>
  <div className="retirement-toolbar">
   <div className="retirement-filters">
    <Field type="search" label="Employee search" placeholder="Name, ID, department or position" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/>
    <Field as="select" hideLabel label="Employment status" options={[{value:'active',label:'Active employees'},{value:'inactive',label:'Inactive employees'},{value:'all',label:'All employees'}]} value={employmentStatus} onChange={e=>{setEmploymentStatus(e.target.value);setPage(1);}}/>
    <Field as="select" hideLabel label="Retirement status" placeholder="All retirement statuses" options={statusOptions} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}/>
   </div>
   {d&&<div className="retirement-setting">
    {canManage&&d.canManageSettings!==false
     ?<RetirementAgeForm key={d.settings.version} settings={d.settings} onSaved={r.reload} disabled={r.loading||!!r.error}/>
     :<span className="muted">Retirement age: {d.settings.retirementAge===null?'Not set':`${d.settings.retirementAge} years`}</span>}
   </div>}
  </div>
  <RetirementTable items={d?.items} loading={r.loading} error={r.error} onRetry={r.reload}/>
  <Pager page={page} pageSize={25} total={d?.total??0} onPage={setPage} disabled={r.loading}/>
 </section>;
}
