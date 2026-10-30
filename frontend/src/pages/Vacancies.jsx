import {useState} from 'react';
import {usePermission} from '../api/auth.jsx';
import {post,put,patch} from '../api/client.js';
import {useResource,ResourceState} from './payrollResource.jsx';
import {tenure,employmentLabel} from './portal/profileView.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table,{Badge,Pager} from '../components/Table.jsx';
import {useToast} from '../components/Toast.jsx';
const SIZE=15;
const label=value=>String(value||'').replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());
const stamp=value=>value?new Date(value).toLocaleString():'—';
const payload=f=>({title:f.title.trim(),description:f.description||'',departmentId:Number(f.departmentId),positionId:Number(f.positionId),closingOn:f.closingOn,status:f.status,...(f.id?{version:f.version}:{})});
export default function Vacancies({employee=false}){
 const canManage=usePermission('vacancies.manage'),canReview=usePermission('vacancies.review'),toast=useToast();
 const [page,setPage]=useState(1),[view,setView]=useState('open'),[status,setStatus]=useState(''),[editing,setEditing]=useState(null),[details,setDetails]=useState(null),[applicants,setApplicants]=useState(null),[applying,setApplying]=useState(null);
 const r=useResource('/vacancies',{page,pageSize:SIZE,view:employee?view:'manage',status:employee?undefined:status});
 async function apply(item){
  if(applying!==null)return;setApplying(item.id);
  try{await post(`/vacancies/${item.id}/apply`);toast.success('Application submitted');r.reload();setDetails(null);}
  catch(e){toast.error(e.message);if(e.status===409)r.reload();}finally{setApplying(null);}
 }
 const applyButton=item=>item.applicationId?<Badge tone="info">{label(item.applicationStatus)}</Badge>:item.acceptingApplications?<Button size="sm" variant="primary" busy={applying===item.id} disabled={applying!==null} onClick={()=>apply(item)}>Apply</Button>:<Badge>Closed</Badge>;
 const columns=[{key:'title',header:'Vacancy',render:item=><button type="button" className="salary-cell" onClick={()=>setDetails(item)}>{item.title}</button>},
  {key:'department',header:'Department'},{key:'position',header:'Position'},{key:'closingOn',header:'Closing date',className:'nowrap'},
  {key:'status',header:'Status',render:item=><Badge tone={item.acceptingApplications?'ok':'neutral'}>{item.status==='open'&&!item.acceptingApplications?'Expired':label(item.status)}</Badge>},
  ...(!employee?[{key:'applicationCount',header:'Applications',align:'num'}]:[]),
  {key:'actions',header:employee?'Application':'Actions',render:item=>employee?applyButton(item):<span className="row">
   {canManage&&<Button size="sm" onClick={()=>setEditing(item)}>Edit</Button>}{canReview&&<Button size="sm" onClick={()=>setApplicants(item)}>Applications</Button>}
   {!canManage&&!canReview&&<Button size="sm" onClick={()=>setDetails(item)}>View</Button>}
  </span>}];
 return <section className="stack vacancies-page">
  <div className="row between"><h1>Internal vacancies</h1>{!employee&&canManage&&<Button variant="primary" onClick={()=>setEditing({title:'',description:'',departmentId:'',positionId:'',closingOn:'',status:'draft'})}>Post vacancy</Button>}</div>
  {employee?<div className="tabs" role="group" aria-label="Vacancies"><Button onClick={()=>{setView('open');setPage(1);}} aria-pressed={view==='open'}>Open vacancies</Button><Button onClick={()=>{setView('mine');setPage(1);}} aria-pressed={view==='mine'}>My applications</Button></div>
   :<Field as="select" label="Status" placeholder="All statuses" value={status} options={['draft','open','closed'].map(value=>({value,label:label(value)}))} onChange={e=>{setStatus(e.target.value);setPage(1);}}/>}
  <Table caption={employee&&view==='mine'?'My vacancy applications':'Internal vacancies'} columns={columns} rows={r.data?.items??[]} loading={r.loading} error={r.error} onRetry={r.reload} empty={employee&&view==='mine'?'No applications yet':'No vacancies found'}/>
  <Pager page={page} pageSize={SIZE} total={r.data?.total??0} onPage={setPage} disabled={r.loading}/>
  {editing&&<VacancyEditor key={editing.id||'new'} item={editing} today={r.data?.today} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);r.reload();}}/>}
  {details&&<Modal open title={details.title} onClose={()=>setDetails(null)} footer={<Button onClick={()=>setDetails(null)}>Close</Button>}><div className="stack">
   <p>{details.department} · {details.position}</p><p>Closing date: {details.closingOn}</p>{details.description&&<p className="profile-summary">{details.description}</p>}{employee&&applyButton(details)}
  </div></Modal>}
  {applicants&&canReview&&<Applications vacancy={applicants} onClose={()=>setApplicants(null)} onChanged={r.reload}/>}
 </section>;
}
function VacancyEditor({item,today,onClose,onSaved}){
 const [form,setForm]=useState(item),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState({});const toast=useToast();
 const departments=useResource('/departments',{pageSize:100}),positions=useResource(form.departmentId?`/departments/${form.departmentId}/positions`:null,{pageSize:100});
 const change=key=>e=>setForm(f=>({...f,[key]:e.target.value}));
 async function save(e){
  e.preventDefault();if(busy)return;setBusy(true);setError('');setFields({});
  try{await (form.id?put(`/vacancies/${form.id}`,payload(form)):post('/vacancies',payload(form)));toast.success('Vacancy saved');onSaved();}
  catch(e){if(e.status===202){toast.success('Vacancy submitted for approval');onSaved();}else{setError(e.message);setFields(e.fields||{});}}finally{setBusy(false);}
 }
 return <Modal open title={item.id?'Edit vacancy':'Post vacancy'} dismissible={!busy} onClose={()=>!busy&&onClose()} footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="vacancy-form" busy={busy} disabled={departments.loading||positions.loading}>Save</Button></>}>
  <form id="vacancy-form" className="stack" onSubmit={save}>
   {error&&<p role="alert" className="form-error">{error}</p>}
   {departments.error&&<ResourceState error={departments.error} onRetry={departments.reload}/>}{positions.error&&<ResourceState error={positions.error} onRetry={positions.reload}/>}
   <Field label="Vacancy title" value={form.title} onChange={change('title')} maxLength={160} required disabled={busy} error={fields.title}/>
   <Field as="select" label="Department" placeholder="Choose department" value={form.departmentId} options={(departments.data?.items??[]).map(d=>({value:d.id,label:d.name}))} onChange={e=>setForm(f=>({...f,departmentId:e.target.value,positionId:''}))} required disabled={busy} error={fields.departmentId}/>
   <Field as="select" label="Position" placeholder="Choose position" value={form.positionId} options={(positions.data?.items??[]).map(p=>({value:p.id,label:p.name}))} onChange={change('positionId')} required disabled={busy||!form.departmentId||positions.loading} error={fields.positionId}/>
   <Field label="Closing date" type="date" min={form.status==='open'?today:undefined} value={form.closingOn} onChange={change('closingOn')} required disabled={busy} error={fields.closingOn}/>
   <Field as="select" label="Status" value={form.status} options={['draft','open','closed'].filter(s=>s!=='draft'||!item.publishedAt).map(value=>({value,label:label(value)}))} onChange={change('status')} disabled={busy} error={fields.status}/>
   <Field as="textarea" label="Details (optional)" value={form.description} onChange={change('description')} maxLength={5000} disabled={busy} error={fields.description}/>
  </form>
 </Modal>;
}
function Applications({vacancy,onClose,onChanged}){
 const [page,setPage]=useState(1),[selected,setSelected]=useState(null),[reviewStatus,setReviewStatus]=useState('shortlisted'),[busy,setBusy]=useState(false),[error,setError]=useState('');const toast=useToast();
 const list=useResource(`/vacancies/${vacancy.id}/applications`,{page,pageSize:SIZE});
 const detail=useResource(selected?`/vacancies/${vacancy.id}/applications/${selected}`:null);
 async function review(){
  if(busy||!detail.data||detail.data.id!==selected)return;setBusy(true);setError('');
  try{await patch(`/vacancies/${vacancy.id}/applications/${selected}`,{status:reviewStatus,version:detail.data.version});toast.success('Application updated');setSelected(null);list.reload();onChanged();}
  catch(e){if(e.status===202){toast.success('Review submitted for approval');setSelected(null);list.reload();onChanged();}else{setError(e.message);if(e.status===409){detail.reload();list.reload();}}}finally{setBusy(false);}
 }
 return <Modal open wide title={`Applications · ${vacancy.title}`} dismissible={!busy} onClose={()=>!busy&&onClose()} footer={<Button disabled={busy} onClick={onClose}>Close</Button>}><div className="stack">
  {error&&<p role="alert" className="form-error">{error}</p>}
  <Table caption="Vacancy applications" columns={[{key:'employeeCode',header:'ID'},{key:'fullName',header:'Employee'},
   {key:'appliedAt',header:'Applied on',render:r=>stamp(r.appliedAt)},{key:'status',header:'Status',render:r=>label(r.status)},
   {key:'reviewedBy',header:'Reviewed by',render:r=>r.reviewedBy||'—'},{key:'reviewedAt',header:'Reviewed on',render:r=>stamp(r.reviewedAt)},
   {key:'profile',header:'Profile',render:r=><Button size="sm" disabled={busy} onClick={()=>{setSelected(r.id);setReviewStatus(r.status==='applied'?'shortlisted':r.status);setError('');}}>View profile</Button>}]} rows={list.data?.items??[]} loading={list.loading} error={list.error} onRetry={list.reload} empty="No applications yet"/>
  <Pager page={page} pageSize={SIZE} total={list.data?.total??0} onPage={setPage} disabled={list.loading||busy}/>
  {selected&&((!detail.data||detail.data.id!==selected)?<ResourceState loading={detail.loading||!detail.error} error={detail.error} onRetry={detail.reload}/>:<section className="card stack">
   <div className="row between"><h2>Profile at application</h2><Button size="sm" disabled={busy} onClick={()=>setSelected(null)}>Close profile</Button></div>
   <small className="muted">Applied on {stamp(detail.data.appliedAt)}</small>
   <ApplicantProfile profile={detail.data.profile}/>
   <Field as="select" label="Application status" value={reviewStatus} options={['shortlisted','selected','rejected'].map(value=>({value,label:label(value)}))} onChange={e=>setReviewStatus(e.target.value)} disabled={busy}/>
   <Button variant="primary" onClick={review} busy={busy} disabled={detail.loading||reviewStatus===detail.data.status}>Save review</Button>
  </section>)}
 </div></Modal>;
}
function ApplicantProfile({profile:p}){
 const facts=[['Name',p.fullName],['Employee ID',p.employeeCode],['Username',p.username],['Department',p.department],['Position',p.position],['Email',p.email],['Phone',p.phone],['Employment type',employmentLabel(p.employmentType)],['Joined',p.startDate],['Experience in company',tenure(p.startDate,p.today)],['Shift',p.shift]];
 return <><dl className="profile-facts">{facts.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value||'—'}</dd></div>)}</dl>
  <h3>Experience</h3><p className="profile-summary">{p.experienceSummary||'Not provided'}</p><h3>Position history</h3>
  <Table caption="Applicant position history" columns={[{key:'department',header:'Department'},{key:'position',header:'Position'},{key:'recordedOn',header:'Recorded on'}]} rows={p.positionHistory} empty="No position history"/>
 </>;
}
