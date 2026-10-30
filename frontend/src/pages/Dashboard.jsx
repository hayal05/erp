import {workspacePath} from '../api/workspaces.js';
import {useLocation} from 'react-router-dom';
import {Link as RouterLink} from 'react-router-dom';
import Table,{Badge} from '../components/Table.jsx';
import {formatMoney} from '../api/money.js';
import {useResource,ResourceState} from './payrollResource.jsx';
const labels={present:'Present',late:'Late',absent:'Absent',on_leave:'On leave',incomplete:'Incomplete'};
const tone={present:'ok',late:'warn',absent:'danger',on_leave:'info',incomplete:'neutral'};
export default function Dashboard(){
 const r=useResource('/dashboard');
 return <section className="stack dashboard"><div className="row between"><h1>Dashboard</h1></div>
 {!r.data?<ResourceState variant="dashboard" loading={r.loading} error={r.error} onRetry={r.reload}/>:<DashboardContent data={r.data}/>}
 </section>;
}
function DashboardContent({data:d}){
 const s=d.stats,p=d.payroll;
 const attendance=[{key:'employeeName',header:'Employee',render:r=><><strong>{r.employeeName}</strong><br/><small className="muted">{r.employeeCode}</small></>},
  {key:'date',header:'Date',className:'nowrap'},{key:'status',header:'Status',render:r=><Badge tone={tone[r.status]??'neutral'}>{labels[r.status]??r.status}</Badge>},
  {key:'checkIn',header:'In',render:r=>r.checkIn??'—'},{key:'checkOut',header:'Out',render:r=>r.checkOut??'—'}];
 const leaves=[{key:'employeeName',header:'Employee'},{key:'leaveType',header:'Leave'},{key:'dates',header:'Dates',render:r=><span className="nowrap">{r.start} – {r.end}</span>},{key:'days',header:'Days',align:'num'}];
 return <>
  <p className="muted">{d.date}</p>
  <div className="dashboard-main-stats">
   <article className="card stack"><h2>Total employees</h2><strong className="dashboard-number">{s.totalEmployees}</strong><WorkspaceLink to="/hr/employees">View employees</WorkspaceLink></article>
   <article className="card stack"><h2>Payroll · {p.month}</h2><strong className="dashboard-number">{p.totalMinor===null?'—':formatMoney(p.totalMinor)}</strong><span className="muted">{p.status?`${p.currencyCode} net salary · ${p.status} · ${p.employeeCount} employees`:'No payroll yet'}</span><WorkspaceLink to={`/hr/payroll?month=${p.month}`}>View payroll</WorkspaceLink></article>
   <article className="card stack"><h2>Present today</h2><strong className="dashboard-number">{s.presentToday}</strong><WorkspaceLink to="/hr/attendance">View attendance</WorkspaceLink></article>
  </div>
  <div className="dashboard-small-stats">
   {[['Late today',s.lateToday],['Absent today',s.absentToday],['On leave today',s.onLeaveToday],['Pending leave',s.pendingLeave]].map(([label,n])=><article className="card" key={label}><h2>{label}</h2><strong className="dashboard-number">{n}</strong></article>)}
  </div>
  <section className="stack"><div className="row between"><h2>Recent attendance</h2><WorkspaceLink to="/hr/attendance">All attendance</WorkspaceLink></div><Table caption="Recent attendance" columns={attendance} rows={d.recentAttendance} empty="No attendance records yet."/></section>
  <section className="stack"><div className="row between"><h2>Pending leave requests</h2><WorkspaceLink to="/hr/leave">View leave requests</WorkspaceLink></div><Table caption="Pending leave requests" columns={leaves} rows={d.pendingLeave} empty="No pending leave requests."/></section>
 </>;
}

function WorkspaceLink({to,...props}){const {pathname}=useLocation();return <RouterLink to={workspacePath(to,pathname)} {...props}/>;}
