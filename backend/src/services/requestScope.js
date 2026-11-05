import {hasPermission,PERMISSIONS} from './permissions.js';
import {permissionScope,scopeSql,assertAttendanceScope,assertEmployeeChangeScope} from './accessScope.js';
import {HttpError} from '../middleware/error.js';
export async function assertReviewScope(db,user,row){
 if(permissionScope(user,row.permission)===null)return;
 if(row.permission==='employees.manage')return assertEmployeeChangeScope(db,user,row.path,row.payload_preview);
 if(row.permission==='attendance.manage'&&/^\/api\/attendance-records\/\d+$/.test(row.path))return assertAttendanceScope(db,user,row.permission,Number(row.path.split('/').at(-1)));
 throw new HttpError(403,'This change is outside your review scope','forbidden');
}
export function requestVisibilitySql(user,params,alias='c'){
 if((user.accessRoles??[]).some(r=>['admin','hr','finance'].includes(r)))return 'TRUE';
 params.push(user.id);const own=`${alias}.requester_id=$${params.length}`;
 const areas=['hr','finance'].filter(area=>hasPermission(user,`changes.${area}.approve`));
 if(!areas.length)return own;
 const unrestricted=PERMISSIONS.filter(p=>hasPermission(user,p)&&permissionScope(user,p)===null);
 params.push(areas,unrestricted);const all=`(${alias}.department=ANY($${params.length-1}::text[]) AND ${alias}.permission=ANY($${params.length}::text[]))`;
 const scoped=[];
 if(areas.includes('hr')&&hasPermission(user,'attendance.manage')&&permissionScope(user,'attendance.manage')!==null){
  const condition=scopeSql(user,'attendance.manage','se',params);
  scoped.push(`(${alias}.department='hr' AND ${alias}.permission='attendance.manage' AND EXISTS(SELECT 1 FROM attendance_records sr JOIN employees se ON se.id=sr.employee_id WHERE ${alias}.path='/api/attendance-records/'||sr.id::text AND ${condition}))`);
 }
 if(areas.includes('hr')&&hasPermission(user,'employees.manage')&&permissionScope(user,'employees.manage')!==null){
  const condition=scopeSql(user,'employees.manage','se',params);
  params.push(permissionScope(user,'employees.manage').departmentIds.map(String));
  const destination=`${alias}.payload_preview->>'departmentId'=ANY($${params.length}::text[])`;
  scoped.push(`(${alias}.department='hr' AND ${alias}.permission='employees.manage' AND (
   (${alias}.path='/api/employees' AND ${destination}) OR
   EXISTS(SELECT 1 FROM employees se WHERE ${condition} AND
    ${alias}.path=ANY(ARRAY['/api/employees/'||se.id::text,'/api/employees/'||se.id::text||'/activate','/api/employees/'||se.id::text||'/deactivate','/api/employees/'||se.id::text||'/attachments']) AND
    (NOT (${alias}.payload_preview ? 'departmentId') OR ${alias}.payload_preview->>'departmentId' IS NOT DISTINCT FROM se.department_id::text OR ${destination}))
  ))`);
 }
 return `(${[own,all,...scoped].join(' OR ')})`;
}
