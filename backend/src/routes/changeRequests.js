import {Router} from 'express';
import {query,withTransaction} from '../db/pool.js';
import {requirePermission} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {wrap,HttpError} from '../middleware/error.js';
import {hasPermission} from '../services/permissions.js';
import {currentUser,canReview,decrypt,fingerprint} from '../services/changeRequests.js';
import {approvalPolicy} from '../services/approvalPolicy.js';
import {approvalTransaction,transactionClient,executeRouter} from '../services/approvalExecution.js';
import {audit} from '../services/audit.js';
const columns=`c.id,c.requester_id,c.department,c.permission,c.method,c.path,c.payload_preview,c.status,c.requested_at,c.reviewer_id,c.reviewed_at,c.review_reason,
 u.full_name AS requester_name,r.full_name AS reviewer_name`;
const joins='FROM change_requests c JOIN users u ON u.id=c.requester_id LEFT JOIN users r ON r.id=c.reviewer_id';
const idOf=req=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)throw new HttpError(400,'Invalid request ID','validation');return id;};
const visible=(user,row)=>hasPermission(user,'approvals.read');
const present=(user,row)=>({...row,id:Number(row.id),canReview:row.status==='pending'&&canReview(user,row),canCancel:row.status==='pending'&&Number(row.requester_id)===user.id});
export default function changeRequestRoutes(operations){
 const router=Router();router.use(noStore,requirePermission('approvals.read'));
 router.get('/',wrap(async(req,res)=>{
  const view=req.query.view??'pending',page=Math.max(1,Number(req.query.page)||1),limit=20;
  if(!['pending','all','mine'].includes(view)||!Number.isSafeInteger(page)||page>1000000)throw new HttpError(400,'Invalid filter','validation');
  const roles=['hr','finance'];
  const where=`WHERE (c.requester_id=$1 OR (c.department=ANY($2::text[])))${view==='pending'?" AND c.status='pending'":view==='mine'?' AND c.requester_id=$1':''}`;
  const params=[req.user.id,roles];
  const {rows:[count]}=await query(`SELECT count(*)::int AS n FROM change_requests c ${where}`,params);
  const {rows}=await query(`SELECT ${columns} ${joins} ${where} ORDER BY c.id DESC LIMIT $3 OFFSET $4`,[...params,limit,(page-1)*limit]);
  res.json({items:rows.map(r=>present(req.user,r)),page,pageSize:limit,total:count.n});
 }));
 router.get('/:id',wrap(async(req,res)=>{
  const {rows:[row]}=await query(`SELECT ${columns} ${joins} WHERE c.id=$1`,[idOf(req)]);
  if(!row||!visible(req.user,row))throw new HttpError(404,'Request not found','not_found');
  res.json(present(req.user,row));
 }));
 router.post('/:id/:decision',wrap(async(req,res)=>{
  const id=idOf(req),decision=req.params.decision;
  if(!['approve','reject','cancel'].includes(decision))throw new HttpError(404,'Route not found','not_found');
  const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
  if(reason.length>1000||(decision==='reject'&&!reason))throw new HttpError(400,'A rejection reason is required (maximum 1000 characters)','validation');
  // Read only the fixed operation metadata before acquiring table locks. Re-read the
  // entire request under lock in the transaction; payload is never trusted from the client.
  const {rows:[hint]}=await query('SELECT method,path FROM change_requests WHERE id=$1',[id]);
  if(!hint)throw new HttpError(404,'Request not found','not_found');
  const policy=approvalPolicy(hint.method,hint.path);
  const result=await withTransaction(async db=>{
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
   // Serialize application with ordinary writes in the affected domain. The locks
   // precede the first snapshot read, preventing stale checks from racing a write.
   if(decision==='approve'&&policy){
    const tables=[...new Set([...policy.tables,'users','employees','access_grants'])].sort();
    await db.query(`LOCK TABLE ${tables.join(',')} IN SHARE ROW EXCLUSIVE MODE`);
   }
   const {rows:[row]}=await db.query('SELECT * FROM change_requests WHERE id=$1 FOR UPDATE',[id]);
   const reviewer=await currentUser(db,req.user.id);
   if(!row||!visible(reviewer,row))throw new HttpError(403,'You cannot review this request','forbidden');
   if(decision==='cancel'?Number(row.requester_id)!==reviewer.id:!canReview(reviewer,row))throw new HttpError(403,'A different authorized person must review this request','forbidden');
   if(row.status!=='pending')return {id,status:row.status};
   let applied;
   if(decision==='approve'){
    if(!policy||policy.permission!==row.permission||policy.department!==row.department)throw new HttpError(409,'Operation policy has changed. Withdraw and submit again.','stale_request');
    const requester=await currentUser(db,row.requester_id);
    if(!hasPermission(requester,row.permission))throw new HttpError(409,'Requester no longer has the required access','requester_unavailable');
    if(await fingerprint(db,policy)!==row.fingerprint)throw new HttpError(409,'Related records have changed. Withdraw this request and submit it again.','stale_request');
    const {rows:[start]}=await db.query('SELECT COALESCE(max(id),0) AS id FROM audit_logs');
    const response=await approvalTransaction.run(transactionClient(db,reviewer.id),()=>executeRouter(operations,req,{method:row.method,path:row.path,body:decrypt(row.payload_cipher),user:requester}));
    applied={status:response.status,body:response.data};
    if(response.status>=400)throw new HttpError(response.status,'The requested change failed validation','operation_failed');
    const {rows:records}=await db.query('SELECT DISTINCT ON (entity_type,entity_id) entity_type,entity_id,details FROM audit_logs WHERE id>$1 AND actor_user_id=$2 ORDER BY entity_type,entity_id,id DESC',[start.id,requester.id]);
    for(const record of records)await audit(db,{actorId:reviewer.id,action:'change.approve',entityType:record.entity_type,entityId:record.entity_id,reason:reason||null,details:{requestId:id,requestedBy:requester.id,...(record.details?.periodId?{periodId:record.details.periodId}:{})}});
   }
   const status={approve:'approved',reject:'rejected',cancel:'cancelled'}[decision];
   await db.query('UPDATE change_requests SET status=$2,reviewer_id=$3,reviewed_at=now(),review_reason=$4,payload_cipher=NULL WHERE id=$1',[id,status,reviewer.id,reason||null]);
   await audit(db,{actorId:reviewer.id,action:`change.${decision}`,entityType:'change_request',entityId:id,reason:reason||null,details:{requestedBy:Number(row.requester_id)}});
   return {id,status,...(applied?{applied}:{})};
  }).catch(error=>{
   if(['40001','40P01'].includes(error.code))throw new HttpError(409,'Related records changed concurrently. Refresh and review again.','conflict');
   throw error;
  });
  res.json(result);
 }));
 return router;
}
