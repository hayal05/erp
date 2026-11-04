import { ACCESS_ROLES, permissionsFor } from './permissions.js';
// Called on login/password responses. Normal requests load grants in the existing session query.
export async function loadAccessRoles(db,userId) {
  const {rows}=await db.query('SELECT access_role FROM access_grants WHERE user_id=$1 AND revoked_at IS NULL ORDER BY access_role',[userId]);
  return rows.map(r=>r.access_role).filter(role=>ACCESS_ROLES.includes(role));
}
export function withAccess(user,roles=[]) {
  const result={...user,accessRoles:[...new Set(roles.filter(role=>ACCESS_ROLES.includes(role)))]};
  return {...result,permissions:permissionsFor(result)};
}

export async function loadCustomGrants(db,userId){
 const {rows}=await db.query(`SELECT g.id,r.id AS "roleId",r.name,r.permissions,g.scope_type AS "scopeType",g.department_ids AS "departmentIds",g.employee_ids AS "employeeIds" FROM custom_access_grants g JOIN custom_access_roles r ON r.id=g.role_id WHERE g.user_id=$1 AND g.revoked_at IS NULL ORDER BY g.id`,[userId]);
 return rows.map(g=>({...g,id:Number(g.id),roleId:Number(g.roleId),departmentIds:g.departmentIds.map(Number),employeeIds:g.employeeIds.map(Number)}));
}
export async function userAccess(db,user,roles){return withAccess({...user,customGrants:await loadCustomGrants(db,user.id)},roles??await loadAccessRoles(db,user.id));}
