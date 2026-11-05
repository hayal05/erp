import {ROLE_PERMISSIONS,hasPermission} from './permissions.js';
import {HttpError} from '../middleware/error.js';
// null means unrestricted for this activity. Multiple grants form a union, independently per activity.
export function permissionScope(user,permission){
 if((user?.accessRoles??[]).some(role=>ROLE_PERMISSIONS[role]?.includes(permission)))return null;
 const grants=(user?.customGrants??[]).filter(g=>g.permissions?.includes(permission));
 if(grants.some(g=>g.scopeType==='all'))return null;
 return {departmentIds:[...new Set(grants.flatMap(g=>g.departmentIds??[]))],employeeIds:[...new Set(grants.flatMap(g=>g.employeeIds??[]))]};
}
export function scopeSql(user,permission,alias,params){
 const s=permissionScope(user,permission);if(s===null)return 'TRUE';
 params.push(s.departmentIds,s.employeeIds);return `(${alias}.department_id=ANY($${params.length-1}::bigint[]) OR ${alias}.id=ANY($${params.length}::bigint[]))`;
}
export async function assertEmployeeScope(db,user,permission,id){
 if(!hasPermission(user,permission))throw new HttpError(403,'This activity is not allowed','forbidden');
 const args=[id],condition=scopeSql(user,permission,'e',args);
 if(!(await db.query(`SELECT e.id FROM employees e WHERE e.id=$1 AND ${condition}`,args)).rows.length)throw new HttpError(404,'Employee not found in your access scope','not_found');
}
export function employeeParamScope(db,permission='employees.read'){
 return (req,res,next,value)=>{const id=Number(value);if(!Number.isSafeInteger(id)||id<1)return next(new HttpError(400,'Invalid employee ID','validation'));
  assertEmployeeScope(db,req.user,permission,id).then(()=>next(),next);
 };
}
export async function assertAttendanceScope(db,user,permission,id){
 const {rows:[r]}=await db.query('SELECT employee_id FROM attendance_records WHERE id=$1',[id]);
 if(!r)throw new HttpError(404,'Attendance record not found','not_found');await assertEmployeeScope(db,user,permission,r.employee_id);
}

export function coversEmployee(user,permission,id,departmentId){
 if(!hasPermission(user,permission))return false;
 const scope=permissionScope(user,permission);return scope===null||scope.employeeIds.includes(Number(id))||scope.departmentIds.includes(Number(departmentId));
}

// Department assignments allow new employees and transfers only into their selected departments.
export function assertDepartmentScope(user,permission,departmentId){
 if(!hasPermission(user,permission))throw new HttpError(403,'This activity is not allowed','forbidden');
 const scope=permissionScope(user,permission);
 if(scope!==null&&!scope.departmentIds.includes(Number(departmentId)))throw new HttpError(403,'Choose a department within your access scope','forbidden');
}
export async function assertEmployeeChangeScope(db,user,path,body={}){
 const permission='employees.manage';
 if(permissionScope(user,permission)===null)return;
 if(path==='/api/employees'){assertDepartmentScope(user,permission,body.departmentId);return;}
 const match=path.match(/^\/api\/employees\/(\d+)(?:\/(?:activate|deactivate|attachments))?$/);
 if(!match)throw new HttpError(403,'This company-wide change requires All employees scope','forbidden');
 const id=Number(match[1]);await assertEmployeeScope(db,user,permission,id);
 if(Object.hasOwn(body,'departmentId')){
  const {rows:[employee]}=await db.query('SELECT department_id FROM employees WHERE id=$1',[id]);
  if(Number(body.departmentId)!==Number(employee.department_id))assertDepartmentScope(user,permission,body.departmentId);
 }
}

export function departmentScopeSql(user,permission,expression,args){
 const scope=permissionScope(user,permission);if(scope===null)return 'TRUE';
 args.push(scope.departmentIds,scope.employeeIds);
 return `(${expression}=ANY($${args.length-1}::bigint[]) OR EXISTS(SELECT 1 FROM employees scope_employee WHERE scope_employee.department_id=${expression} AND scope_employee.id=ANY($${args.length}::bigint[])))`;
}
export async function assertDepartmentReadScope(db,user,permission,id){
 if(!Number.isSafeInteger(Number(id))||Number(id)<1)throw new HttpError(400,'Invalid department ID','validation');
 const args=[id],condition=departmentScopeSql(user,permission,'d.id',args);
 if(!(await db.query(`SELECT d.id FROM departments d WHERE d.id=$1 AND ${condition}`,args)).rows.length)throw new HttpError(404,'Department not found','not_found');
}
