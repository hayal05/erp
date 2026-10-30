import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { HttpError,wrap } from '../middleware/error.js';
import { validate,v } from '../middleware/validate.js';
import { pageSchema,pageOffset,pageResult,likePattern } from '../services/sql.js';
import { idParams } from '../services/hrSchemas.js';
const router=Router();router.use(noStore,requirePermission('access.read'));
router.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():requirePermission('access.manage')(req,res,next));
const roles=['hr','finance'];
async function employee(db,id,{lock=false}={}){
 const {rows:[r]}=await db.query(`SELECT e.id,e.user_id,e.status,u.is_active,u.role FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=$1${lock?' FOR UPDATE OF e,u':''}`,[id]);
 if(!r||r.role!=='employee')throw new HttpError(404,'Registered employee not found','not_found');return r;
}
router.get('/employees',validate({...pageSchema,search:v.string({max:120})},'query'),wrap(async(req,res)=>{
 const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const search=likePattern(req.query.search||'');
  const from=`FROM employees e JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id
   LEFT JOIN positions p ON p.id=e.position_id WHERE u.role='employee' AND (u.full_name ILIKE $1 OR u.username ILIKE $1 OR u.email ILIKE $1 OR e.employee_code ILIKE $1)`;
  const {rows}=await db.query(`SELECT e.id,e.employee_code,u.full_name,u.username,u.email,e.status,u.is_active,d.name AS department,COALESCE(p.name,e.job_title) AS position,
   ARRAY(SELECT access_role FROM access_grants g WHERE g.user_id=u.id AND g.revoked_at IS NULL ORDER BY access_role) AS roles
   ${from} ORDER BY lower(u.full_name),e.id LIMIT $2 OFFSET $3`,[search,req.query.pageSize,pageOffset(req.query)]);
  const {rows:[count]}=await db.query(`SELECT count(*)::int AS total ${from}`,[search]);
  return pageResult(rows.map(r=>({id:Number(r.id),employeeCode:r.employee_code,fullName:r.full_name,username:r.username,email:r.email,status:r.status,
   active:r.status==='active'&&r.is_active,department:r.department,position:r.position,accessRoles:r.roles})),req.query,count.total);
 });res.json(result);
}));
router.get('/employees/:id/history',validate(idParams,'params'),validate(pageSchema,'query'),wrap(async(req,res)=>{
 const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const e=await employee(db,req.params.id);
  const {rows}=await db.query(`SELECT g.id,g.access_role,g.granted_at,g.revoked_at,g.revoke_reason,
   a.full_name AS granted_by,r.full_name AS revoked_by FROM access_grants g
   LEFT JOIN users a ON a.id=g.granted_by_user_id LEFT JOIN users r ON r.id=g.revoked_by_user_id
   WHERE g.user_id=$1 ORDER BY g.granted_at DESC,g.id DESC LIMIT $2 OFFSET $3`,[e.user_id,req.query.pageSize,pageOffset(req.query)]);
  const {rows:[count]}=await db.query('SELECT count(*)::int AS total FROM access_grants WHERE user_id=$1',[e.user_id]);
  const {rows:current}=await db.query('SELECT access_role FROM access_grants WHERE user_id=$1 AND revoked_at IS NULL ORDER BY access_role',[e.user_id]);
  return {...pageResult(rows.map(r=>({id:Number(r.id),role:r.access_role,grantedAt:r.granted_at,grantedBy:r.granted_by||'System bootstrap',
   revokedAt:r.revoked_at,revokedBy:r.revoked_by,revokeReason:r.revoke_reason})),req.query,count.total),accessRoles:current.map(r=>r.access_role)};
 });res.json(result);
}));
router.post('/employees/:id/grants',validate(idParams,'params'),validate({role:v.enum({required:true,values:roles})}),wrap(async(req,res)=>{
 const result=await withTransaction(async db=>{
  const e=await employee(db,req.params.id,{lock:true});
  if(e.status!=='active'||!e.is_active)throw new HttpError(409,'Activate this employee before granting access','inactive_employee');
  const {rows:[existing]}=await db.query('SELECT id FROM access_grants WHERE user_id=$1 AND access_role=$2 AND revoked_at IS NULL',[e.user_id,req.body.role]);
  if(existing)return {id:Number(existing.id),created:false};
  const {rows:[r]}=await db.query('INSERT INTO access_grants(user_id,access_role,granted_by_user_id) VALUES($1,$2,$3) RETURNING id',[e.user_id,req.body.role,req.user.id]);
  return {id:Number(r.id),created:true};
 });res.status(result.created?201:200).json(result);
}));
router.post('/employees/:id/grants/:grantId/revoke',validate({...idParams,grantId:v.int({required:true,min:1})},'params'),validate({reason:v.string({required:true,min:3,max:500})}),wrap(async(req,res)=>{
 await withTransaction(async db=>{
  const e=await employee(db,req.params.id,{lock:true});
  const {rows:[g]}=await db.query("SELECT * FROM access_grants WHERE id=$1 AND user_id=$2 AND access_role IN ('hr','finance') FOR UPDATE",[req.params.grantId,e.user_id]);
  if(!g)throw new HttpError(404,'HR or Finance grant not found for this employee','not_found');
  if(g.revoked_at)return; // safe retry; preserve the original actor and reason
  await db.query('UPDATE access_grants SET revoked_at=now(),revoked_by_user_id=$2,revoke_reason=$3 WHERE id=$1',[g.id,req.user.id,req.body.reason]);
 });res.sendStatus(204);
}));
export default router;
