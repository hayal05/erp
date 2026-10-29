import {Router} from 'express';
import {withTransaction} from '../db/pool.js';
import {requireAuth} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {validate,v} from '../middleware/validate.js';
import {HttpError,wrap} from '../middleware/error.js';
import {pageSchema,pageOffset,pageResult} from '../services/sql.js';
import {AUDIT_RECORDS,canReadAudit,auditChanges} from '../services/auditHistory.js';
const router=Router();router.use(noStore,requireAuth);
router.get('/:type/:id',validate({type:v.enum({required:true,values:Object.keys(AUDIT_RECORDS)}),id:v.int({required:true,min:1})},'params'),validate(pageSchema,'query'),wrap(async(req,res)=>{
 const {type,id}=req.params,c=AUDIT_RECORDS[type];
 if(!canReadAudit(req.user,type))throw new HttpError(403,'You do not have access to this record history','forbidden');
 const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows:[record]}=await db.query(`SELECT ${type==='access_employee'?'id,user_id':c.singleton?'1 AS present':'id'} FROM ${c.table}${c.singleton?'':' WHERE id=$1'}`,c.singleton?[]:[id]);
  if(!record||(c.singleton&&id!==1))throw new HttpError(404,'Record not found','not_found');
  let condition='a.entity_type=$1 AND a.entity_id=$2';let args=[c.entity,String(id)];
  if(type==='access_employee'){condition="a.entity_type=$1 AND a.details->>'userId'=$2";args=[c.entity,String(record.user_id)];}
  if(type==='settlement_period')condition="a.entity_type=$1 AND EXISTS(SELECT 1 FROM payroll_settlements s WHERE s.id::text=a.entity_id AND s.period_id=$2::bigint)";
  if(type==='payroll_settings'){condition='a.entity_type=$1 AND a.entity_id IS NULL';args=[c.entity];}
  if(type==='payroll_period')condition="((a.entity_type=$1 AND a.entity_id=$2) OR (a.entity_type='payroll_entry' AND a.details->>'periodId'=$2))";
  condition=`(${condition}) AND a.action<>'attendance.photo_view'`;
  const cte=`WITH events AS (SELECT a.id,a.action,a.occurred_at AS at,u.full_name AS actor,a.reason,a.details FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE ${condition})`;
  const {rows}=await db.query(`${cte} SELECT * FROM events ORDER BY at DESC,id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,req.query.pageSize,pageOffset(req.query)]);
  const {rows:[count]}=await db.query(`${cte} SELECT count(*)::int AS total FROM events`,args);
  const {rows:[summary]}=await db.query(`${cte} SELECT
   (SELECT row_to_json(x) FROM (SELECT actor,at FROM events WHERE action ~ '(^|\\.)(create|generate|request|grant)$' ORDER BY at,id LIMIT 1)x) AS created,
   (SELECT row_to_json(x) FROM (SELECT actor,at FROM events WHERE action !~ '(^|\\.)(approve|pay)$' ORDER BY at DESC,id DESC LIMIT 1)x) AS modified,
   (SELECT row_to_json(x) FROM (SELECT actor,at FROM events WHERE action ~ '(^|\\.)approve$' ORDER BY at DESC,id DESC LIMIT 1)x) AS approved`,args);
  return {...pageResult(rows.map(r=>({id:Number(r.id),action:r.action,actor:r.actor||'System / not recorded',at:r.at,reason:r.reason,changes:auditChanges(r.details,c.fields)})),req.query,count.total),summary};
 });res.json(result);
}));export default router;
