import {hasPermission,PERMISSIONS} from './permissions.js';
import {permissionScope,scopeSql,assertAttendanceScope} from './accessScope.js';
import {HttpError} from '../middleware/error.js';
export async function assertReviewScope(db,user,row){
 if(permissionScope(user,row.permission)===null)return;
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
 if(!areas.includes('hr')||!hasPermission(user,'attendance.manage')||permissionScope(user,'attendance.manage')===null)return `(${own} OR ${all})`;
 const condition=scopeSql(user,'attendance.manage','se',params);
 return `(${own} OR ${all} OR (${alias}.department='hr' AND ${alias}.permission='attendance.manage' AND EXISTS(SELECT 1 FROM attendance_records sr JOIN employees se ON se.id=sr.employee_id WHERE ${alias}.path='/api/attendance-records/'||sr.id::text AND ${condition})))`;
}
