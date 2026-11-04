import {employeeParamScope} from '../services/accessScope.js';
import {approvalTransaction} from '../services/approvalExecution.js';
import express,{Router} from 'express';
import {query,withTransaction} from '../db/pool.js';
import {requirePermission} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {validate} from '../middleware/validate.js';
import {wrap,HttpError} from '../middleware/error.js';
import {approvalWrap} from '../middleware/approval.js';
import {idParams} from '../services/hrSchemas.js';
import {pageOffset,pageResult} from '../services/sql.js';
import {audit} from '../services/audit.js';
import {attachmentStore} from '../services/attachmentStore.js';
import {attachmentListQuery,attachmentParams,parseAttachment,sendAttachment,MAX_ATTACHMENT_BASE64} from '../services/employeeAttachments.js';
export const attachmentDeps={store:attachmentStore};
const router=Router();router.use(noStore,requirePermission('employees.read'));router.param('id',employeeParamScope({query}));
const exists=async(db,id)=>{if(!(await db.query('SELECT id FROM employees WHERE id=$1',[id])).rows.length)throw new HttpError(404,'Employee not found','not_found');};
router.get('/:id/attachments',validate(idParams,'params'),validate(attachmentListQuery,'query'),wrap(async(req,res)=>{
 res.json(await withTransaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await exists(db,req.params.id);
  const args=[req.params.id,req.query.direction];
  const {rows}=await db.query(`SELECT a.id,a.file_name AS "fileName",a.byte_size AS "byteSize",a.mime_type AS "mimeType",a.direction,a.uploaded_at AS "uploadedAt",COALESCE(u.username,u.full_name) AS "uploadedBy" FROM employee_attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.employee_id=$1 AND a.direction=$2 ORDER BY a.id DESC LIMIT $3 OFFSET $4`,[...args,req.query.pageSize,pageOffset(req.query)]);
  const {rows:[count]}=await db.query('SELECT count(*)::int AS total FROM employee_attachments WHERE employee_id=$1 AND direction=$2',args);
  return pageResult(rows.map(r=>({...r,id:Number(r.id)})),req.query,count.total);
 }));
}));
router.get('/:id/attachments/:attachmentId/download',validate(attachmentParams,'params'),wrap(async(req,res)=>{
 const {rows:[r]}=await query('SELECT file_name AS "fileName",mime_type AS "mimeType",byte_size AS "byteSize",storage_id FROM employee_attachments WHERE employee_id=$1 AND id=$2',[req.params.id,req.params.attachmentId]);
 if(!r)throw new HttpError(404,'Attachment not found','not_found');
 const bytes=await attachmentDeps.store.download(r.storage_id);if(bytes.length!==r.byteSize)throw new HttpError(502,'Stored file is incomplete','storage_failed');sendAttachment(res,r,bytes);
}));
router.post('/:id/attachments',requirePermission('employees.manage'),validate(idParams,'params'),express.json({limit:MAX_ATTACHMENT_BASE64+4096}),wrap(async(req,res,next)=>{
 const file=parseAttachment(req.body);await exists({query},req.params.id);
 req.body={direction:file.direction,fileName:file.fileName,fileBase64:file.bytes.toString('base64'),byteSize:file.byteSize,mimeType:file.mimeType};next();
}),approvalWrap(async(req,res)=>{
 const file=parseAttachment(req.body);let storageId;
 try{
  const saved=await withTransaction(async db=>{
   await exists(db,req.params.id);storageId=await attachmentDeps.store.upload(file);
   approvalTransaction.getStore()?.onRollback?.(()=>attachmentDeps.store.delete(storageId));
   const {rows:[r]}=await db.query('INSERT INTO employee_attachments(employee_id,direction,file_name,mime_type,byte_size,storage_id,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[req.params.id,file.direction,file.fileName,file.mimeType,file.byteSize,storageId,req.user.id]);
   await audit(db,{actorId:req.user.id,action:'employee_attachment.create',entityType:'employee_attachment',entityId:r.id,details:{employeeId:req.params.id,direction:file.direction,fileName:file.fileName,byteSize:file.byteSize}});
   return {id:Number(r.id),fileName:file.fileName,direction:file.direction};
  });res.status(201).json(saved);
 }catch(error){if(storageId)await attachmentDeps.store.delete(storageId).catch(()=>{});throw error;}
}));
export default router;
