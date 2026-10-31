import {HttpError} from '../middleware/error.js';
import {config} from '../config.js';
import {companyDate} from './attendance.js';
import {audit} from './audit.js';
import {pageOffset,pageResult} from './sql.js';
const zone=config.company.timezone;
export const vacancyColumns=`v.id,v.title,v.description,v.status,v.version,v.department_id AS "departmentId",v.position_id AS "positionId",
 d.name AS department,p.name AS position,to_char(v.closing_on,'YYYY-MM-DD') AS "closingOn",
 v.published_at AS "publishedAt",(v.status='open' AND v.closing_on>=(now() AT TIME ZONE $1)::date) AS "acceptingApplications"`;
export const vacancyFrom='FROM internal_vacancies v JOIN departments d ON d.id=v.department_id JOIN positions p ON p.id=v.position_id';
export const vacancyOutput=r=>({...r,id:Number(r.id),departmentId:Number(r.departmentId),positionId:Number(r.positionId),...(r.applicationId?{applicationId:Number(r.applicationId)}:{})});
export async function loadVacancies(db,user,query){
 const manage=query.view==='manage';
 const where=manage?(query.status?'v.status=$3':'true'):query.view==='mine'?'a.id IS NOT NULL':"v.status='open' AND v.closing_on>=(now() AT TIME ZONE $1)::date";
 const args=[zone,user.id,...(manage&&query.status?[query.status]:[])];
 const from=`${vacancyFrom} LEFT JOIN employees e ON e.user_id=$2 LEFT JOIN vacancy_applications a ON a.vacancy_id=v.id AND a.employee_id=e.id`;
 const extra=manage?',(SELECT count(*)::int FROM vacancy_applications va WHERE va.vacancy_id=v.id) AS "applicationCount"':`,(a.id IS NULL AND NOT EXISTS(SELECT 1 FROM vacancy_views seen WHERE seen.vacancy_id=v.id AND seen.employee_id=e.id)) AS unopened`;
 const {rows}=await db.query(`SELECT ${vacancyColumns},a.id AS "applicationId",a.status AS "applicationStatus",a.applied_at AS "appliedAt" ${extra} ${from}
 WHERE ${where} ORDER BY v.created_at DESC,v.id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,query.pageSize,pageOffset(query)]);
 const {rows:[count]}=await db.query(`SELECT count(*)::int total ${from} WHERE ${where} AND $1::text IS NOT NULL`,args);
 return {...pageResult(rows.map(vacancyOutput),query,count.total),today:companyDate()};
}
// Only employee facts needed for recruitment are copied. Never salaries, passwords,
// grants, leave/attendance records or photos. The copy cannot later be rewritten.
async function profileSnapshot(db,employeeId){
 const {rows:[profile]}=await db.query(`SELECT e.employee_code AS "employeeCode",u.full_name AS "fullName",u.username,u.email,e.phone,
 e.gender,to_char(e.date_of_birth,'YYYY-MM-DD') AS "dateOfBirth",e.field_of_study AS "fieldOfStudy",
 d.name AS department,COALESCE(p.name,e.job_title) AS position,e.employment_type AS "employmentType",
 to_char(e.start_date,'YYYY-MM-DD') AS "startDate",s.name AS shift,e.experience_summary AS "experienceSummary"
 FROM employees e JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id
 LEFT JOIN positions p ON p.id=e.position_id JOIN shifts s ON s.id=e.shift_id WHERE e.id=$1`,[employeeId]);
 const {rows}=await db.query(`SELECT id,department_name AS department,position_name AS position,
 to_char(recorded_at AT TIME ZONE $2,'YYYY-MM-DD') AS "recordedOn",is_baseline AS baseline
 FROM employee_position_history WHERE employee_id=$1 ORDER BY recorded_at DESC,id DESC`,[employeeId,zone]);
 return {...profile,today:companyDate(),positionHistory:rows};
}
export async function applyForVacancy(db,user,vacancyId){
 const {rows:[vacancy]}=await db.query(`SELECT id,status,closing_on>=(now() AT TIME ZONE $2)::date AS timely
 FROM internal_vacancies WHERE id=$1 FOR SHARE`,[vacancyId,zone]);
 if(!vacancy||vacancy.status!=='open'||!vacancy.timely)throw new HttpError(409,'This vacancy is not accepting applications','vacancy_closed');
 const {rows:[employee]}=await db.query(`SELECT e.id FROM employees e JOIN users u ON u.id=e.user_id
 WHERE e.user_id=$1 AND e.status='active' AND u.is_active FOR SHARE OF e,u`,[user.id]);
 if(!employee)throw new HttpError(403,'An active employee profile is required','employee_inactive');
 const snapshot=await profileSnapshot(db,employee.id);
 const {rows:[row]}=await db.query(`INSERT INTO vacancy_applications(vacancy_id,employee_id,profile_snapshot)
 VALUES($1,$2,$3::jsonb) ON CONFLICT(vacancy_id,employee_id) DO NOTHING RETURNING id,status,applied_at AS "appliedAt"`,[vacancyId,employee.id,JSON.stringify(snapshot)]);
 if(!row)throw new HttpError(409,'You have already applied for this vacancy','already_applied');
 await db.query('INSERT INTO vacancy_views(vacancy_id,employee_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[vacancyId,employee.id]);
 await audit(db,{actorId:user.id,action:'vacancy.apply',entityType:'vacancy_application',entityId:row.id,details:{vacancyId,status:'applied'}});
 return {...row,id:Number(row.id)};
}


export async function vacancyUnreadCount(db,userId){
 const {rows:[r]}=await db.query(`SELECT count(*)::int AS "unreadCount" FROM internal_vacancies v
 JOIN employees e ON e.user_id=$1 AND e.status='active'
 WHERE v.status='open' AND v.closing_on>=(now() AT TIME ZONE $2)::date
 AND NOT EXISTS(SELECT 1 FROM vacancy_views seen WHERE seen.vacancy_id=v.id AND seen.employee_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM vacancy_applications a WHERE a.vacancy_id=v.id AND a.employee_id=e.id)`,[userId,zone]);
 return r.unreadCount;
}
export async function openVacancy(db,userId,vacancyId){
 const {rows:[employee]}=await db.query("SELECT id FROM employees WHERE user_id=$1 AND status='active'",[userId]);
 if(!employee)throw new HttpError(403,'An active employee profile is required','employee_inactive');
 const {rows:[vacancy]}=await db.query(`SELECT v.id FROM internal_vacancies v WHERE v.id=$1 AND
 ((v.status='open' AND v.closing_on>=(now() AT TIME ZONE $3)::date)
 OR EXISTS(SELECT 1 FROM vacancy_applications a WHERE a.vacancy_id=v.id AND a.employee_id=$2)) FOR SHARE OF v`,[vacancyId,employee.id,zone]);
 if(!vacancy)throw new HttpError(404,'Vacancy not found','not_found');
 await db.query('INSERT INTO vacancy_views(vacancy_id,employee_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[vacancyId,employee.id]);
 return {id:Number(vacancyId)};
}
