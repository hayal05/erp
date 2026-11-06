import {scopeSql} from './accessScope.js';
import {v} from '../middleware/validate.js';
import {pageSchema,pageOffset,pageResult,likePattern} from './sql.js';
import {companyDate} from './attendance.js';
export const retirementSettingBody={retirementAge:v.int({required:true,min:18,max:100}),version:v.int({required:true,min:1})};
export const retirementListQuery={...pageSchema,search:v.string({max:100}),employmentStatus:v.enum({values:['active','inactive','all'],default:'active'}),status:v.enum({values:['reached','within_year','later','missing_birth_date','not_configured']})};
export async function retirementSettings(db){
 const {rows:[r]}=await db.query('SELECT retirement_age,version FROM retirement_settings WHERE id=1');
 return {retirementAge:r.retirement_age,version:r.version};
}
// Calendar anniversaries clamp Feb 29 to Feb 28 in non-leap years, for both age and retirement date.
export async function loadRetirement(db,query,{today=companyDate(),user=null}={}){
 const settings=await retirementSettings(db);
 const args=[today,settings.retirementAge,query.employmentStatus,query.search?likePattern(query.search):null,query.status??null];
 const departmentFilter = query.departmentId == null ? 'TRUE' : `e.department_id=$${args.push(query.departmentId)}`;
 const scope=user?scopeSql(user,'employees.read','e',args):'TRUE';
 const cte=`WITH dates AS (
  SELECT e.id,e.employee_code,u.full_name,d.name AS department,p.name AS position,e.status AS employment_status,e.date_of_birth,
   CASE WHEN e.date_of_birth<=$1::date THEN EXTRACT(YEAR FROM $1::date)::int-EXTRACT(YEAR FROM e.date_of_birth)::int END AS year_difference,
   CASE WHEN e.date_of_birth<=$1::date AND $2::int IS NOT NULL THEN (e.date_of_birth+make_interval(years=>$2::int))::date END AS retirement_date
  FROM employees e JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id
  WHERE ${scope} AND ${departmentFilter} AND ($3='all' OR e.status=$3) AND ($4::text IS NULL OR u.full_name ILIKE $4 ESCAPE '\\' OR e.employee_code ILIKE $4 ESCAPE '\\' OR d.name ILIKE $4 ESCAPE '\\' OR p.name ILIKE $4 ESCAPE '\\')
 ), calculated AS (
  SELECT *,year_difference-CASE WHEN $1::date<(date_of_birth+make_interval(years=>year_difference))::date THEN 1 ELSE 0 END AS age,
   retirement_date-$1::date AS days_remaining,
   CASE WHEN date_of_birth IS NULL OR date_of_birth>$1::date THEN 'missing_birth_date' WHEN $2::int IS NULL THEN 'not_configured'
    WHEN retirement_date<=$1::date THEN 'reached' WHEN retirement_date<=($1::date+INTERVAL '1 year')::date THEN 'within_year' ELSE 'later' END AS retirement_status FROM dates
 ), filtered AS (SELECT * FROM calculated WHERE $5::text IS NULL OR retirement_status=$5)`;
 const {rows}=await db.query(`${cte} SELECT id,employee_code,full_name,department,position,employment_status,to_char(date_of_birth,'YYYY-MM-DD') AS birth_date,age,to_char(retirement_date,'YYYY-MM-DD') AS retirement_date,days_remaining,retirement_status FROM filtered ORDER BY retirement_date NULLS LAST,full_name,id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,query.pageSize,pageOffset(query)]);
 const {rows:[count]}=await db.query(`${cte} SELECT count(*)::int AS total FROM filtered`,args);
 return {...pageResult(rows.map(r=>({id:Number(r.id),employeeCode:r.employee_code,fullName:r.full_name,department:r.department,position:r.position,employmentStatus:r.employment_status,dateOfBirth:r.birth_date,age:r.age,retirementDate:r.retirement_date,daysRemaining:r.days_remaining,status:r.retirement_status})),query,count.total),today,settings};
}
