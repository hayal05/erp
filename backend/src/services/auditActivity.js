import {AUDIT_RECORDS,canReadAudit,auditChanges} from './auditHistory.js';
import {hasPermission} from './permissions.js';
import {HttpError} from '../middleware/error.js';
import {pageOffset,pageResult} from './sql.js';
const record=(type,entity=AUDIT_RECORDS[type].entity)=>({entity,fields:AUDIT_RECORDS[type].fields,allowed:user=>canReadAudit(user,type)});
const extra=(entity,permission,domains,fields)=>({entity,fields,allowed:user=>hasPermission(user,permission)&&domains.some(p=>hasPermission(user,p))});
const sources={
 employee:record('employee'),salary:record('salary_profile'),department:record('department'),position:record('position'),
 attendance:record('attendance_record'),leave:record('leave_request'),announcement:record('announcement'),
 payroll:record('payroll_period'),entry:record('payroll_period','payroll_entry'),access:record('access_employee'),
 settlement:record('settlement_period'),calculation:record('payroll_settings'),
 shift:extra('shift','organization.manage',['audit.hr'],['name','startTime','endTime','workDays','graceMinutes']),
 holiday:extra('holiday','organization.manage',['audit.hr'],['name','date']),
 balance:extra('leave_balance','leave.manage',['audit.hr'],['employeeId','leaveTypeId','year','entitledDays','adjustedDays','adjustDays']),
 deduction:extra('deduction_item','deductions.manage',['audit.finance'],['employeeId','kind','name','amountMinor','recurring','enabled']),
 brackets:extra('income_tax_brackets','payroll_settings.read',['audit.hr','audit.finance'],[]),
 tax:extra('other_tax','payroll_settings.read',['audit.hr','audit.finance'],['name','rate','base','enabled']),
 request:extra('change_request','approvals.read',['audit.hr','audit.finance'],['department','requestedBy']),
};
export const AUDIT_AREAS={
 all:Object.keys(sources),employees:['employee','salary'],departments:['department','position'],attendance:['attendance'],
 leave:['leave','balance'],announcements:['announcement'],payroll:['payroll','entry','deduction'],
 payroll_settings:['calculation','brackets','tax'],settlements:['settlement'],access:['access'],settings:['shift','holiday'],approvals:['request'],
};
// Permission predicates use the same record capabilities as individual history.
// The area is only a filter: choosing another area can never widen access.
export async function loadAuditActivity(db,user,query){
 const selected=(AUDIT_AREAS[query.area]??[]).map(key=>sources[key]).filter(s=>s.allowed(user));
 if(!selected.length)throw new HttpError(403,'You do not have access to this section audit history','forbidden');
 const roles=hasPermission(user,'access.manage')?['hr','finance']:(user.accessRoles??[]).filter(r=>['hr','finance'].includes(r));
 const args=[selected.map(s=>s.entity),user.id,roles,user.permissions??[]];
 const cte=`WITH events AS (SELECT a.id,a.action,a.entity_type,a.entity_id,a.occurred_at AS at,u.full_name AS actor,u.username,a.actor_user_id,a.reason,a.details,
 EXISTS(SELECT 1 FROM access_grants g WHERE g.user_id=a.actor_user_id AND g.access_role='admin'
   AND g.granted_at<=a.occurred_at AND (g.revoked_at IS NULL OR g.revoked_at>a.occurred_at)) AS was_admin
 FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
 WHERE a.entity_type=ANY($1::text[]) AND a.action<>'attendance.photo_view'
 AND (a.entity_type<>'change_request' OR EXISTS(SELECT 1 FROM change_requests c WHERE c.id::text=a.entity_id
   AND (c.requester_id=$2 OR (c.department=ANY($3::text[]) AND c.permission=ANY($4::text[]))))))`;
 const {rows}=await db.query(`${cte} SELECT * FROM events ORDER BY at DESC,id DESC LIMIT $5 OFFSET $6`,[...args,query.pageSize,pageOffset(query)]);
 const summaryFilter=query.area==='approvals'?'true':"entity_type<>'change_request'";
 const {rows:[metadata]}=await db.query(`${cte}, latest_modified AS (
 SELECT * FROM events WHERE ${summaryFilter} AND action !~ '(^|\\.)(approve|pay)$' ORDER BY at DESC,id DESC LIMIT 1
 ) SELECT (SELECT count(*)::int FROM events) AS total,
 (SELECT row_to_json(x) FROM (SELECT CASE WHEN was_admin THEN COALESCE(username,actor) ELSE actor END AS actor,at,entity_type AS type,entity_id AS id FROM latest_modified)x) AS modified,
 COALESCE((SELECT row_to_json(x) FROM (SELECT CASE WHEN e.was_admin THEN COALESCE(e.username,e.actor) ELSE e.actor END AS actor,e.at,e.entity_type AS type,e.entity_id AS id FROM events e JOIN latest_modified m
   ON e.entity_type=m.entity_type AND e.entity_id IS NOT DISTINCT FROM m.entity_id
   WHERE e.action ~ '(^|\\.)approve$' AND (e.at>m.at OR (e.at=m.at AND e.id>m.id))
   ORDER BY e.at DESC,e.id DESC LIMIT 1)x),
 (SELECT row_to_json(x) FROM (SELECT COALESCE(username,actor) AS actor,at,entity_type AS type,entity_id AS id
   FROM latest_modified WHERE was_admin AND entity_type<>'change_request')x)) AS approved`,args);
 return {...pageResult(rows.map(r=>({id:Number(r.id),type:r.entity_type,recordId:r.entity_id,action:r.action,actor:r.actor||'System / not recorded',at:r.at,reason:r.reason,
 changes:auditChanges(r.details,selected.find(s=>s.entity===r.entity_type).fields)})),query,metadata.total),summary:{modified:metadata.modified,approved:metadata.approved}};
}
