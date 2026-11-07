import {scopeSql} from './accessScope.js';
import {config} from '../config.js';
export async function loadDashboard(db,{now=null,user=null}={}){
 const {rows:[clock]}=await db.query(`SELECT to_char(COALESCE($2::timestamptz,now()) AT TIME ZONE $1,'YYYY-MM-DD') AS today,
  to_char(COALESCE($2::timestamptz,now()) AT TIME ZONE $1,'HH24:MI:SS') AS clock,
  to_char(COALESCE($2::timestamptz,now()) AT TIME ZONE $1,'YYYY-MM') AS month`,[config.company.timezone,now]);
 const args=[clock.today,clock.clock],scope=user?scopeSql(user,'dashboard.read','e',args):'TRUE';
 const {rows:[stats]}=await db.query(`WITH employee_totals AS (
  SELECT count(*)::int AS total_employees,count(*) FILTER(WHERE gender='male')::int AS male,
   count(*) FILTER(WHERE gender='female')::int AS female,count(*) FILTER(WHERE gender IS NULL)::int AS unspecified FROM employees e WHERE ${scope}
 ), department_totals AS (
  SELECT e.department_id,d.name,count(*)::int AS count FROM employees e LEFT JOIN departments d ON d.id=e.department_id
  WHERE ${scope} GROUP BY e.department_id,d.name
 ), retirement_dates AS (
  SELECT s.retirement_age,(e.date_of_birth+make_interval(years=>s.retirement_age))::date AS retirement_date
  FROM retirement_settings s LEFT JOIN employees e ON e.status='active' AND e.date_of_birth<=$1::date AND ${scope}
 ), retirement_totals AS (
  SELECT retirement_age,count(*) FILTER(WHERE retirement_date>$1::date AND retirement_date<=($1::date+INTERVAL '3 months')::date)::int AS nearing,
   count(*) FILTER(WHERE retirement_date<=$1::date)::int AS passed FROM retirement_dates GROUP BY retirement_age
 ), classified AS (
  SELECT CASE WHEN a.id IS NOT NULL THEN a.status
   WHEN EXTRACT(ISODOW FROM $1::date)::int=ANY(s.work_days) AND NOT EXISTS(SELECT 1 FROM holidays h WHERE h.holiday_date=$1::date)
    THEN CASE WHEN EXISTS(SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='approved' AND $1::date BETWEEN l.start_date AND l.end_date)
      THEN 'on_leave' WHEN $2::time>s.end_time THEN 'absent' END END AS status,a.check_in_at
  FROM employees e JOIN shifts s ON s.id=e.shift_id LEFT JOIN attendance_records a ON a.employee_id=e.id AND a.work_date=$1::date
  WHERE e.status='active' AND e.start_date<=$1::date AND ${scope})
 SELECT (SELECT retirement_age FROM retirement_totals) AS retirement_age,
  (SELECT nearing FROM retirement_totals) AS retirement_nearing,(SELECT passed FROM retirement_totals) AS retirement_passed,
  (SELECT total_employees FROM employee_totals) AS total_employees,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',department_id,'name',COALESCE(name,'Unassigned'),'count',count)
   ORDER BY count DESC,name NULLS LAST,department_id) FROM department_totals),'[]'::jsonb) AS department_counts,
  (SELECT male FROM employee_totals) AS male,(SELECT female FROM employee_totals) AS female,
  (SELECT unspecified FROM employee_totals) AS unspecified,
  count(*) FILTER(WHERE status IN ('present','late') OR (status='incomplete' AND check_in_at IS NOT NULL))::int AS present_today,
  count(*) FILTER(WHERE status='late')::int AS late_today,
  count(*) FILTER(WHERE status='absent')::int AS absent_today,
  count(*) FILTER(WHERE status='on_leave')::int AS on_leave_today,
  (SELECT count(*)::int FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.status='pending' AND ${scope}) AS pending_leave FROM classified`,args);
 const payArgs=[`${clock.month}-01`],payScope=user?scopeSql(user,'dashboard.read','se',payArgs):'TRUE';
 const {rows:[payroll]}=await db.query(`SELECT p.status,p.config_snapshot->'settings'->>'currencyCode' AS currency_code,
  COALESCE(sum(pe.net_minor),0)::text AS total_minor,count(pe.id)::int AS employee_count
  FROM payroll_periods p LEFT JOIN payroll_entries pe ON pe.period_id=p.id LEFT JOIN employees se ON se.id=pe.employee_id WHERE p.period_month=$1::date AND ${payScope}
  GROUP BY p.id`,payArgs);
 const recentArgs=[config.company.timezone],recentScope=user?scopeSql(user,'dashboard.read','e',recentArgs):'TRUE';
 const {rows:recent}=await db.query(`SELECT a.id,e.employee_code,u.full_name,to_char(a.work_date,'YYYY-MM-DD') AS work_date,a.status,
  to_char(a.check_in_at AT TIME ZONE $1,'HH24:MI') AS check_in,to_char(a.check_out_at AT TIME ZONE $1,'HH24:MI') AS check_out
  FROM attendance_records a JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id
  WHERE ${recentScope} ORDER BY a.work_date DESC,a.updated_at DESC,a.id DESC LIMIT 8`,recentArgs);
 const pendingArgs=[],pendingScope=user?scopeSql(user,'dashboard.read','e',pendingArgs):'TRUE';
 const {rows:pending}=await db.query(`SELECT l.id,e.employee_code,u.full_name,t.name AS leave_type,
  to_char(l.start_date,'YYYY-MM-DD') AS start_date,to_char(l.end_date,'YYYY-MM-DD') AS end_date,l.days
  FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN users u ON u.id=e.user_id JOIN leave_types t ON t.id=l.leave_type_id
  WHERE l.status='pending' AND ${pendingScope} ORDER BY l.created_at,l.id LIMIT 6`,pendingArgs);
 const totalMinor=payroll?Number(payroll.total_minor):null;
 if(totalMinor!==null&&!Number.isSafeInteger(totalMinor))throw new Error('Payroll total exceeds safe money range');
 const employeeGender=Object.fromEntries(['male','female','unspecified'].map(key=>[key,{count:stats[key],percentage:stats.total_employees?Math.round(stats[key]/stats.total_employees*1000)/10:0}]));
 const retirement={retirementAge:stats.retirement_age,nearing:stats.retirement_age===null?null:stats.retirement_nearing,passed:stats.retirement_age===null?null:stats.retirement_passed};
 return {retirement,employeeGender,employeeDepartments:stats.department_counts??[],date:clock.today,timeZone:config.company.timezone,stats:{totalEmployees:stats.total_employees,presentToday:stats.present_today,lateToday:stats.late_today,absentToday:stats.absent_today,onLeaveToday:stats.on_leave_today,pendingLeave:stats.pending_leave},
  payroll:{month:clock.month,status:payroll?.status??null,totalMinor,currencyCode:payroll?.currency_code??'ETB',employeeCount:payroll?.employee_count??0},
  recentAttendance:recent.map(r=>({id:Number(r.id),employeeCode:r.employee_code,employeeName:r.full_name,date:r.work_date,status:r.status,checkIn:r.check_in,checkOut:r.check_out})),
  pendingLeave:pending.map(r=>({id:Number(r.id),employeeCode:r.employee_code,employeeName:r.full_name,leaveType:r.leave_type,start:r.start_date,end:r.end_date,days:r.days}))};
}
