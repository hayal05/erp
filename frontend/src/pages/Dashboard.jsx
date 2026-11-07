import {workspacePath} from '../api/workspaces.js';
import {useLocation} from 'react-router-dom';
import {Link as RouterLink} from 'react-router-dom';
import Table,{Badge} from '../components/Table.jsx';
import {useResource,ResourceState} from './payrollResource.jsx';
const labels={present:'Present',late:'Late',absent:'Absent',on_leave:'On leave',incomplete:'Incomplete'};
const tone={present:'ok',late:'warn',absent:'danger',on_leave:'info',incomplete:'neutral'};
export default function Dashboard(){
 const r=useResource('/dashboard');
 return <section className="stack dashboard"><div className="row between dashboard-heading"><h1>Dashboard</h1>{r.data && <time className="muted" dateTime={r.data.date}>{r.data.date}</time>}</div>
 {!r.data?<ResourceState variant="dashboard" loading={r.loading} error={r.error} onRetry={r.reload}/>:<DashboardContent data={r.data}/>}
 </section>;
}
function DashboardContent({data:d}){
 const s=d.stats;
 const attendance=[{key:'employeeName',header:'Employee',render:r=><span className="dashboard-employee"><strong>{r.employeeName}</strong><small className="muted">{r.employeeCode}</small></span>},
  {key:'date',header:'Date',className:'nowrap'},{key:'status',header:'Status',render:r=><Badge tone={tone[r.status]??'neutral'}>{labels[r.status]??r.status}</Badge>},
  {key:'checkIn',header:'In',render:r=>r.checkIn??'—'},{key:'checkOut',header:'Out',render:r=>r.checkOut??'—'}];
 const leaves=[{key:'employeeName',header:'Employee'},{key:'leaveType',header:'Leave'},{key:'dates',header:'Dates',render:r=><span className="nowrap">{r.start} – {r.end}</span>},{key:'days',header:'Days',align:'num'}];
 return <>
  <div className="dashboard-main-stats">
   <article className="card dashboard-stat"><div className="row between"><h2>Employees</h2><WorkspaceLink to="/hr/employees" aria-label="View employees">View</WorkspaceLink></div><strong className="dashboard-number">{s.totalEmployees}</strong>

   </article>
   <article className="card dashboard-stat"><div className="row between"><h2>Present today</h2><WorkspaceLink to="/hr/attendance" aria-label="View attendance">View</WorkspaceLink></div><strong className="dashboard-number">{s.presentToday}</strong></article>
   <article className="card dashboard-stat dashboard-retirement"><div className="row between"><h2>Retirement</h2><WorkspaceLink to="/hr/retirement" aria-label="View retirement">View</WorkspaceLink></div>
    {d.retirement?.retirementAge!=null?<dl className="dashboard-retirement-counts"><div><dt>Nearing · 3 months</dt><dd className="dashboard-number">{d.retirement.nearing}</dd></div><div><dt>Passed</dt><dd className="dashboard-number">{d.retirement.passed}</dd></div></dl>:<span className="muted">Retirement age not set</span>}
   </article>
  </div>
  <div className="dashboard-small-stats">
   {[['Late today',s.lateToday],['Absent today',s.absentToday],['On leave today',s.onLeaveToday],['Pending leave',s.pendingLeave]].map(([label,n])=><article className="card dashboard-mini" key={label}><h2>{label}</h2><strong className="dashboard-number">{n}</strong></article>)}
  </div>
  <DashboardCharts gender={d.employeeGender} departments={d.employeeDepartments??[]} total={s.totalEmployees}/>
  <div className="dashboard-tables"><section className="stack"><div className="row between"><h2>Recent attendance</h2><WorkspaceLink to="/hr/attendance">All attendance</WorkspaceLink></div><Table caption="Recent attendance" columns={attendance} rows={d.recentAttendance} empty="No attendance records yet."/></section>
  <section className="stack"><div className="row between"><h2>Pending leave requests</h2><WorkspaceLink to="/hr/leave">All requests</WorkspaceLink></div><Table caption="Pending leave requests" columns={leaves} rows={d.pendingLeave} empty="No pending leave requests."/></section></div>
 </>;
}

function DashboardCharts({gender,departments,total}){
 const segments=[['male','Male','var(--accent)'],['female','Female','var(--ok)'],['unspecified','Unspecified','var(--muted)']]
  .map(([key,label,color])=>({key,label,color,count:gender?.[key]?.count??0,percentage:gender?.[key]?.percentage??0}))
  .filter(s=>s.key!=='unspecified'||s.count>0);
 let offset=0;
 const max=Math.max(1,...departments.map(d=>d.count));
 return <div className="dashboard-charts">
  <section className="card dashboard-chart"><h2>Gender share</h2><div className="dashboard-donut-body">
   <svg className="dashboard-donut" viewBox="0 0 160 160" role="img" aria-label={`Gender share · ${total} employees`}>
    <circle cx="80" cy="80" r="58" fill="none" stroke="var(--border)" strokeWidth="18"/>
    {segments.map(s=>{const length=total?s.count/total*100:0;const start=offset;offset+=length;
     return length>0?<circle key={s.key} cx="80" cy="80" r="58" fill="none" stroke={s.color} strokeWidth="18" pathLength="100" strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"><title>{`${s.label}: ${s.count} (${s.percentage}%)`}</title></circle>:null;})}
    <text x="80" y="79" textAnchor="middle" className="dashboard-donut-total">{total}</text>
    <text x="80" y="100" textAnchor="middle" className="dashboard-donut-label">Employees</text>
   </svg>
   <dl className="dashboard-gender" aria-label="Employee gender share">{segments.map(s=><div key={s.key}><dt><i className="dashboard-chart-dot" style={{background:s.color}} aria-hidden="true"/>{s.label}</dt><dd><strong>{s.count}</strong> <span className="muted">({s.percentage}%)</span></dd></div>)}</dl>
  </div></section>
  <section className="card dashboard-chart"><h2>Employees by department</h2>
   {departments.length?<div className="dashboard-bars" tabIndex="0" role="region" aria-label="Department headcount"><dl>{departments.map(d=><div className="dashboard-bar-row" key={d.id??'unassigned'}><dt title={d.name}>{d.name}</dt><dd><span className="dashboard-bar-track" aria-hidden="true"><span style={{width:`${d.count/max*100}%`}}/></span><strong>{d.count}</strong></dd></div>)}</dl></div>:<p className="muted">No employees</p>}
  </section>
 </div>;
}
function WorkspaceLink({to,...props}){const {pathname}=useLocation();return <RouterLink to={workspacePath(to,pathname)} {...props}/>;}
