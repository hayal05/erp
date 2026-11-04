import EmployeeAttachments from './EmployeeAttachments.jsx';
import {useState} from 'react';
import {Link,useLocation,useParams} from 'react-router-dom';
import {workspacePath} from '../api/workspaces.js';
import {useResource,ResourceState} from './payrollResource.jsx';
import {Badge,Pager} from '../components/Table.jsx';
import {initials} from '../components/hrNav.js';
import {formatWorkDate} from './attendanceForm.js';
import {tenure} from './portal/profileView.js';
const SIZE=10;
const types={full_time:'Full time',part_time:'Part time',contract:'Contract',intern:'Intern'};
export default function EmployeeProfile(){
 const {id}=useParams(),{pathname}=useLocation();
 const [paging,setPaging]=useState({id,page:1});
 const page=paging.id===id?paging.page:1,setPage=page=>setPaging({id,page});
 const r=useResource(`/employees/${id}/profile`,{page,pageSize:SIZE});
 return <section className="stack admin-employee-profile">
  <div className="row between"><h1>Employee profile</h1><Link className="btn sm" to={workspacePath('/hr/employees',pathname)}>Back to employees</Link></div>
  {r.error?<ResourceState error={r.error} onRetry={r.reload}/>:!r.data||r.data.id!==Number(id)?<ResourceState variant="profile" loading={r.loading}/>:<EmployeeProfileDetails key={id} profile={r.data} page={page} onPage={setPage} loading={r.loading}/>}
 </section>;
}
function Facts({items}){
 return <dl className="profile-facts">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}</dl>;
}
export function EmployeeProfileDetails({profile:p,page=1,onPage,loading=false}){
 const history=p.positionHistory;
 return <>
  <header className="card employee-profile-hero">
   <div className="employee-profile-avatar" aria-hidden="true">{initials(p.fullName)}</div>
   <div className="employee-profile-identity"><h2>{p.fullName}</h2><p className="employee-profile-role">{p.positionName||p.jobTitle||'—'}</p>
    <div className="row"><span className="muted">{p.departmentName||'—'}</span><Badge tone={p.status==='active'?'ok':'neutral'}>{p.status==='active'?'Active':'Inactive'}</Badge></div>
    <small className="muted">Employee ID · {p.employeeCode}</small>
   </div>
  </header>
  <div className="admin-profile-columns">
   <section className="card stack employee-profile-section"><h2>Personal details</h2><Facts items={[
    ['Full name',p.fullName],['Gender',p.gender==='male'?'Male':p.gender==='female'?'Female':null],['Date of birth',p.dateOfBirth?formatWorkDate(p.dateOfBirth):null],['Field of study',p.fieldOfStudy]]}/></section>
   <section className="card stack employee-profile-section"><h2>Employment</h2><Facts items={[
    ['Department',p.departmentName],['Position',p.positionName||p.jobTitle||null],['Joined',formatWorkDate(p.startDate)],['Time employed',tenure(p.startDate,p.today)],['Employment type',types[p.employmentType]||p.employmentType],['Shift',p.shiftName]]}/></section>
   <section className="card stack employee-profile-section"><h2>Contact &amp; account</h2><Facts items={[
    ['Username',p.username],['Email',p.email],['Phone',p.phone]]}/></section>
  </div>
  <div className="admin-profile-records">
   <section className="card stack employee-profile-section"><h2>Experience</h2><p className="profile-summary">{p.experienceSummary||'No experience added.'}</p></section>
   <section className="card stack employee-profile-section" aria-busy={loading||undefined}><h2>Position history</h2>
    {!history.items.length?<p className="muted">No position history recorded.</p>:<>
     <ol className="employee-profile-timeline">{history.items.map(item=><li key={item.id}>
      <div className="row between"><strong>{item.position||'—'}</strong><time className="muted" dateTime={item.recordedOn}>{formatWorkDate(item.recordedOn)}</time></div>
      <span className="muted">{item.department||'—'}</span><small className="muted">{item.baseline?'Starting record':'Assignment update'}</small>
     </li>)}</ol><small className="muted">Recorded dates reflect tracking, not appointment dates.</small>
    </>}
    {(history.total>SIZE||page>1)&&<Pager page={page} pageSize={SIZE} total={history.total} onPage={onPage} disabled={loading}/>}
   </section>
  </div>
  <div className="admin-profile-records"><EmployeeAttachments key={`${p.id}-incoming`} employeeId={p.id} direction="incoming"/><EmployeeAttachments key={`${p.id}-outgoing`} employeeId={p.id} direction="outgoing"/></div>
 </>;
}
