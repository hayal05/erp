import {Router} from 'express';
import {withTransaction,query} from '../db/pool.js';
import {requirePermission} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {wrap,HttpError} from '../middleware/error.js';
import {validate,v} from '../middleware/validate.js';
import {validationError} from '../services/dbErrors.js';
import {audit} from '../services/audit.js';
import {pageSchema,pageOffset,pageResult} from '../services/sql.js';
import {idParams} from '../services/hrSchemas.js';
import {ACTIVITY_GROUPS,ACTIVITY_IDS,SCOPED_ACTIVITIES,expandActivities,activityScopePlan} from '../../../shared/accessActivities.mjs';
const router=Router();router.use(noStore,requirePermission('access.manage'));
const roleDto=r=>({...r,permissions:expandActivities(r.activities),id:Number(r.id)});
function roleBody(body){
 const name=typeof body?.name==='string'?body.name.trim():'';
 if(!name||name.length>80||['admin','general admin','master admin','hr','finance'].includes(name.toLowerCase()))throw validationError({name:'Choose a unique custom role name (1–80 characters)'});
 const a=body.activities;if(!Array.isArray(a)||!a.length||a.length>ACTIVITY_IDS.length||a.some(p=>!ACTIVITY_IDS.includes(p)))throw validationError({activities:'Select allowed activities from the list'});
 return {name,activities:[...new Set(a)].sort(),permissions:expandActivities(a)};
}
const hasScopedActivities=activities=>activityScopePlan(activities,'departments').permissions.length>0;
router.get('/roles',wrap(async(req,res)=>{const {rows}=await query('SELECT id,name,activities,permissions,version FROM custom_access_roles ORDER BY lower(name),id');const {rows:departments}=await query('SELECT id,name FROM departments ORDER BY lower(name),id');res.json({items:rows.map(roleDto),departments:departments.map(d=>({...d,id:Number(d.id)})),groups:ACTIVITY_GROUPS,scopedActivities:SCOPED_ACTIVITIES});}));
router.post('/roles',wrap(async(req,res)=>{
 const b=roleBody(req.body);
 const saved=await withTransaction(async db=>{const {rows:[r]}=await db.query('INSERT INTO custom_access_roles(name,activities,permissions,created_by,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING id,name,activities,permissions,version',[b.name,b.activities,b.permissions,req.user.id]);await audit(db,{actorId:req.user.id,action:'access_role.create',entityType:'custom_access_role',entityId:r.id,details:b});return roleDto(r);}).catch(e=>{if(e.code==='23505')throw validationError({name:'This role name already exists'});throw e;});res.status(201).json(saved);
}));
router.put('/roles/:id',validate(idParams,'params'),wrap(async(req,res)=>{
 const b=roleBody(req.body);if(!Number.isSafeInteger(req.body.version)||req.body.version<1)throw validationError({version:'Open the role again before saving'});
 const saved=await withTransaction(async db=>{
  const {rows:[before]}=await db.query('SELECT * FROM custom_access_roles WHERE id=$1 FOR UPDATE',[req.params.id]);if(!before)throw new HttpError(404,'Role not found','not_found');
  if(before.version!==req.body.version)throw new HttpError(409,'Role changed. Open it again before saving.','conflict');
  if(!hasScopedActivities(b.activities)&&(await db.query("SELECT 1 FROM custom_access_grants WHERE role_id=$1 AND revoked_at IS NULL AND scope_type<>'all' LIMIT 1",[before.id])).rows.length)throw validationError({activities:'Keep at least one employee-scoped activity while department or employee assignments are active'});
  const {rows:[r]}=await db.query('UPDATE custom_access_roles SET name=$2,activities=$3,permissions=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING id,name,activities,permissions,version',[before.id,b.name,b.activities,b.permissions,req.user.id]);
  await audit(db,{actorId:req.user.id,action:'access_role.update',entityType:'custom_access_role',entityId:r.id,details:{changes:{name:{from:before.name,to:b.name},activities:{from:before.activities,to:b.activities}}}});return roleDto(r);
 }).catch(e=>{if(e.code==='23505')throw validationError({name:'This role name already exists'});throw e;});res.json(saved);
}));
router.get('/employees/:id/custom-grants',validate(idParams,'params'),validate(pageSchema,'query'),wrap(async(req,res)=>{
 const {rows}=await query(`SELECT g.id,g.role_id AS "roleId",r.name,g.scope_type AS "scopeType",g.department_ids AS "departmentIds",g.employee_ids AS "employeeIds",g.granted_at AS "grantedAt",g.revoked_at AS "revokedAt",g.revoke_reason AS "revokeReason",
 ARRAY(SELECT d.name FROM departments d WHERE d.id=ANY(g.department_ids) ORDER BY d.name) AS "departmentNames",
 ARRAY(SELECT u.full_name||' · '||se.employee_code FROM employees se JOIN users u ON u.id=se.user_id WHERE se.id=ANY(g.employee_ids) ORDER BY u.full_name) AS "employeeNames" FROM custom_access_grants g JOIN custom_access_roles r ON r.id=g.role_id JOIN employees e ON e.user_id=g.user_id WHERE e.id=$1 ORDER BY g.id DESC LIMIT $2 OFFSET $3`,[req.params.id,req.query.pageSize,pageOffset(req.query)]);
 const {rows:[count]}=await query('SELECT count(*)::int AS total FROM custom_access_grants g JOIN employees e ON e.user_id=g.user_id WHERE e.id=$1',[req.params.id]);
 res.json(pageResult(rows.map(g=>({...g,id:Number(g.id),roleId:Number(g.roleId),departmentIds:g.departmentIds.map(Number),employeeIds:g.employeeIds.map(Number)})),req.query,count.total));
}));
router.post('/employees/:id/custom-grants',validate(idParams,'params'),validate({roleId:v.int({required:true,min:1}),scopeType:v.enum({required:true,values:['all','departments','employees']}),departmentIds:v.intList({min:1,maxItems:1000}),employeeIds:v.intList({min:1,maxItems:10000})}),wrap(async(req,res)=>{
 const b=req.body,departmentIds=b.departmentIds??[],employeeIds=b.employeeIds??[];
 if(b.scopeType==='all'&&(departmentIds.length||employeeIds.length)||b.scopeType==='departments'&&(!departmentIds.length||employeeIds.length)||b.scopeType==='employees'&&(!employeeIds.length||departmentIds.length))throw validationError({scopeType:'Select records for the chosen scope only'});
 const saved=await withTransaction(async db=>{
  const {rows:[role]}=await db.query('SELECT * FROM custom_access_roles WHERE id=$1 FOR UPDATE',[b.roleId]);if(!role)throw new HttpError(404,'Role not found','not_found');
  if(b.scopeType!=='all'&&!hasScopedActivities(role.activities))throw validationError({scopeType:'This role has no employee-scoped activities. Add one or choose All employees.'});
  const {rows:[e]}=await db.query("SELECT e.user_id,e.status,u.is_active,u.role FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=$1 FOR UPDATE OF e,u",[req.params.id]);
  if(!e||e.role!=='employee')throw new HttpError(404,'Registered employee not found','not_found');if(e.status!=='active'||!e.is_active)throw new HttpError(409,'Activate the employee before granting access','inactive_employee');
  for(const [table,ids] of [['departments',departmentIds],['employees',employeeIds]])if(ids.length&&(await db.query(`SELECT id FROM ${table} WHERE id=ANY($1::bigint[])`,[ids])).rows.length!==ids.length)throw validationError({scopeType:'One or more selected records no longer exist'});
  const {rows:[existing]}=await db.query('SELECT id FROM custom_access_grants WHERE user_id=$1 AND role_id=$2 AND revoked_at IS NULL',[e.user_id,role.id]);if(existing)throw new HttpError(409,'Revoke the current assignment before changing its scope','conflict');
  const {rows:[r]}=await db.query('INSERT INTO custom_access_grants(user_id,role_id,scope_type,department_ids,employee_ids,granted_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[e.user_id,role.id,b.scopeType,departmentIds,employeeIds,req.user.id]);
  await audit(db,{actorId:req.user.id,action:'custom_access.grant',entityType:'custom_access_grant',entityId:r.id,details:{userId:Number(e.user_id),employeeId:req.params.id,roleName:role.name,scopeType:b.scopeType,departmentIds,employeeIds}});return {id:Number(r.id)};
 });res.status(201).json(saved);
}));
router.post('/employees/:id/custom-grants/:grantId/revoke',validate({...idParams,grantId:v.int({required:true,min:1})},'params'),validate({reason:v.string({required:true,min:3,max:500})}),wrap(async(req,res)=>{
 await withTransaction(async db=>{
  const {rows:[g]}=await db.query('SELECT g.* FROM custom_access_grants g JOIN employees e ON e.user_id=g.user_id WHERE g.id=$1 AND e.id=$2 FOR UPDATE OF g',[req.params.grantId,req.params.id]);if(!g)throw new HttpError(404,'Assignment not found','not_found');if(g.revoked_at)return;
  await db.query('UPDATE custom_access_grants SET revoked_at=now(),revoked_by=$2,revoke_reason=$3 WHERE id=$1',[g.id,req.user.id,req.body.reason]);
  await audit(db,{actorId:req.user.id,action:'custom_access.revoke',entityType:'custom_access_grant',entityId:g.id,reason:req.body.reason,details:{userId:Number(g.user_id),employeeId:req.params.id,roleId:Number(g.role_id)}});
 });res.sendStatus(204);
}));
export default router;
