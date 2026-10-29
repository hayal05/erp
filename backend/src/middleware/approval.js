import {wrap, HttpError} from './error.js';
import {query,withTransaction} from '../db/pool.js';
import {hasPermission} from '../services/permissions.js';
import {approvalPolicy,leaveDecision} from '../services/approvalPolicy.js';
import {APPROVED_EXECUTION} from '../services/approvalExecution.js';
import {encrypt,preview,dedupe,fingerprint,currentUser} from '../services/changeRequests.js';
import {audit} from '../services/audit.js';

// Applied only to administrative routers, after their existing permission/validation middleware.
export const approvalWrap=fn=>wrap(async(req,res,next)=>{
 const method=req.method,path=req.originalUrl.split('?')[0].replace(/\/+$/,'');
 if(['GET','HEAD','OPTIONS'].includes(method)||req[APPROVED_EXECUTION]||hasPermission(req.user,'access.manage')||leaveDecision(method,path))return fn(req,res,next);
 const policy=approvalPolicy(method,path);
 if(!policy||!hasPermission(req.user,policy.permission))throw new HttpError(403,'This operation cannot be submitted for approval','forbidden');
 const body=req.body??{},hash=dedupe(method,path,req.body??{});
 const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const user=await currentUser(db,req.user.id);
  if(!hasPermission(user,policy.permission))throw new HttpError(403,'Access has changed','forbidden');
  const {rows:[existing]}=await db.query("SELECT id FROM change_requests WHERE requester_id=$1 AND dedupe_key=$2 AND status='pending'",[user.id,hash]);
  if(existing)return existing;
  const {rows:[row]}=await db.query(`INSERT INTO change_requests(requester_id,department,permission,method,path,payload_cipher,payload_preview,fingerprint,dedupe_key)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[user.id,policy.department,policy.permission,method,path,encrypt(body),preview(body),await fingerprint(db,policy),hash]);
  await audit(db,{actorId:user.id,action:'change.request',entityType:'change_request',entityId:row.id,details:{department:policy.department,method,path}});
  return row;
 }).catch(async error=>{
  if(error.code==='23505'&&error.constraint==='change_requests_pending_key'){
   const {rows:[row]}=await query("SELECT id FROM change_requests WHERE requester_id=$1 AND dedupe_key=$2 AND status='pending'",[req.user.id,hash]);
   if(row)return row;
  }
  if(['40001','40P01'].includes(error.code))throw new HttpError(409,'Related records changed concurrently. Submit again.','conflict');
  throw error;
 });
 res.status(202).json({code:'approval_pending',requestId:Number(result.id),message:`Request #${result.id} submitted for approval. Live records have not changed.`});
});
