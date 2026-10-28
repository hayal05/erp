import {Link} from 'react-router-dom';
import Button from '../components/Button.jsx';
import Table,{Badge} from '../components/Table.jsx';
import {formatMoney} from '../api/money.js';
import {useResource,ResourceState} from './payrollResource.jsx';
const labels={present:'Present',late:'Late',absent:'Absent',on_leave:'On leave',incomplete:'Incomplete'};
const tone={present:'ok',late:'warn',absent:'danger',on_leave:'info',incomplete:'neutral'};
export default function Dashboard(){
 const r=useResource('/dashboard');
 return <section className="stack dashboard"><div className="row between"><h1>Dashboard</h1><Button onClick={r.reload} disabled={r.loading}>Refresh</Button></div>
 {!r.data?<ResourceState loading={r.loading} error={r.error} onRetry={r.reload}/>:<DashboardContent data={r.data}/>}
 </section>;
}
function DashboardContent({data:d}){
 const s=d.stats,p=d.payroll;
 const attendance=[{key:'employeeName',header:'Employee',render:r=><><strong>{r.employeeName}</strong><br/><small className="muted">{r.employeeCode}</small></>},
  {key:'date',header:'Date',className:'nowrap'},{key:'status',header:'Status',render:r=><Badge tone={tone[r.status]??'neutral'}>{labels[r.status]??r.status}</Badge>},
  {key:'checkIn',header:'In',render:r=>r.checkIn??'—'},{key:'checkOut',header:'Out',render:r=>r.checkOut??'—'}];
 const leaves=[{key:'employeeName',header:'Employee'},{key:'leaveType',header:'Leave'},{key:'dates',header:'Dates',render:r=><span className="nowrap">{r.start} – {r.end}</span>},{key:'days',header:'Days',align:'num'}];
 return <>
  <p className="muted">{d.date} · {d.timeZone}. Refresh to update these figures.</p>
  <div className="dashboard-main-stats">
   <article className="card stack"><h2>Total employees</h2><strong className="dashboard-number">{s.totalEmployees}</strong><Link to="/hr/employees">View employees</Link></article>
   <article className="card stack"><h2>Payroll · {p.month}</h2><strong className="dashboard-number">{p.totalMinor===null?'—':formatMoney(p.totalMinor)}</strong><span className="muted">{p.status?`${p.currencyCode} net salary · ${p.status} · ${p.employeeCount} employees`:'No payroll generated this month'}</span><Link to={`/hr/payroll?month=${p.month}`}>View payroll</Link></article>
   <article className="card stack"><h2>Present today</h2><strong className="dashboard-number">{s.presentToday}</strong><span className="muted">Includes late arrivals and employees with an incomplete check-out.</span><Link to="/hr/attendance">View attendance</Link></article>
  </div>
  <div className="dashboard-small-stats">
   {[['Late today',s.lateToday],['Absent today',s.absentToday],['On leave today',s.onLeaveToday],['Pending leave',s.pendingLeave]].map(([label,n])=><article className="card" key={label}><h2>{label}</h2><strong className="dashboard-number">{n}</strong></article>)}
  </div>
  <p className="muted">Attendance counts cover active employees who have started. Missing attendance counts as absent only after the scheduled shift ends; holidays and approved leave are excluded.</p>
  <section className="stack"><div className="row between"><h2>Recent attendance</h2><Link to="/hr/attendance">All attendance</Link></div><Table caption="Recent attendance" columns={attendance} rows={d.recentAttendance} empty="No attendance records yet."/></section>
  <section className="stack"><div className="row between"><h2>Pending leave requests</h2><Link to="/hr/leave">Review leave requests</Link></div><Table caption="Pending leave requests" columns={leaves} rows={d.pendingLeave} empty="No pending leave requests."/></section>
 </>;
}
