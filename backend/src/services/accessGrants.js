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
