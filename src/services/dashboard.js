import {config} from '../config.js';
export async function loadDashboard(db,{now=null}={}){
 const {rows:[clock]}=await db.query(`SELECT to_char(COALESCE($2::timestamptz,now()) AT TIME ZONE $1,'YYYY-MM-DD') AS today,
  to_char(COALESCE($2::timestamptz,now()) AT TIME ZONE $1,'HH24:MI:SS') AS clock,
  to_char(COALESCE($2::timestamptz,now()) AT TIME ZONE $1,'YYYY-MM') AS month`,[config.company.timezone,now]);
 const {rows:[stats]}=await db.query(`WITH classified AS (
  SELECT CASE WHEN a.id IS NOT NULL THEN a.status
   WHEN EXTRACT(ISODOW FROM $1::date)::int=ANY(s.work_days) AND NOT EXISTS(SELECT 1 FROM holidays h WHERE h.holiday_date=$1::date)
    THEN CASE WHEN EXISTS(SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='approved' AND $1::date BETWEEN l.start_date AND l.end_date)
      THEN 'on_leave' WHEN $2::time>s.end_time THEN 'absent' END END AS status,a.check_in_at
  FROM employees e JOIN shifts s ON s.id=e.shift_id LEFT JOIN attendance_records a ON a.employee_id=e.id AND a.work_date=$1::date
  WHERE e.status='active' AND e.start_date<=$1::date)
 SELECT (SELECT count(*)::int FROM employees) AS total_employees,
  count(*) FILTER(WHERE status IN ('present','late') OR (status='incomplete' AND check_in_at IS NOT NULL))::int AS present_today,
  count(*) FILTER(WHERE status='late')::int AS late_today,
  count(*) FILTER(WHERE status='absent')::int AS absent_today,
  count(*) FILTER(WHERE status='on_leave')::int AS on_leave_today,
  (SELECT count(*)::int FROM leave_requests WHERE status='pending') AS pending_leave FROM classified`,[clock.today,clock.clock]);
 const {rows:[payroll]}=await db.query(`SELECT p.status,p.config_snapshot->'settings'->>'currencyCode' AS currency_code,
  COALESCE(sum(pe.net_minor),0)::text AS total_minor,count(pe.id)::int AS employee_count
  FROM payroll_periods p LEFT JOIN payroll_entries pe ON pe.period_id=p.id WHERE p.period_month=$1::date
  GROUP BY p.id`,[`${clock.month}-01`]);
 const {rows:recent}=await db.query(`SELECT a.id,e.employee_code,u.full_name,to_char(a.work_date,'YYYY-MM-DD') AS work_date,a.status,
  to_char(a.check_in_at AT TIME ZONE $1,'HH24:MI') AS check_in,to_char(a.check_out_at AT TIME ZONE $1,'HH24:MI') AS check_out
  FROM attendance_records a JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id
  ORDER BY a.work_date DESC,a.updated_at DESC,a.id DESC LIMIT 8`,[config.company.timezone]);
 const {rows:pending}=await db.query(`SELECT l.id,e.employee_code,u.full_name,t.name AS leave_type,
  to_char(l.start_date,'YYYY-MM-DD') AS start_date,to_char(l.end_date,'YYYY-MM-DD') AS end_date,l.days
  FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN users u ON u.id=e.user_id JOIN leave_types t ON t.id=l.leave_type_id
  WHERE l.status='pending' ORDER BY l.created_at,l.id LIMIT 6`);
 const totalMinor=payroll?Number(payroll.total_minor):null;
 if(totalMinor!==null&&!Number.isSafeInteger(totalMinor))throw new Error('Payroll total exceeds safe money range');
 return {date:clock.today,timeZone:config.company.timezone,stats:{totalEmployees:stats.total_employees,presentToday:stats.present_today,lateToday:stats.late_today,absentToday:stats.absent_today,onLeaveToday:stats.on_leave_today,pendingLeave:stats.pending_leave},
  payroll:{month:clock.month,status:payroll?.status??null,totalMinor,currencyCode:payroll?.currency_code??'ETB',employeeCount:payroll?.employee_count??0},
  recentAttendance:recent.map(r=>({id:Number(r.id),employeeCode:r.employee_code,employeeName:r.full_name,date:r.work_date,status:r.status,checkIn:r.check_in,checkOut:r.check_out})),
  pendingLeave:pending.map(r=>({id:Number(r.id),employeeCode:r.employee_code,employeeName:r.full_name,leaveType:r.leave_type,start:r.start_date,end:r.end_date,days:r.days}))};
}
