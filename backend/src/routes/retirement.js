import {Router} from 'express';
import {withTransaction} from '../db/pool.js';
import {requirePermission} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {validate} from '../middleware/validate.js';
import {HttpError} from '../middleware/error.js';
import {approvalWrap as wrap} from '../middleware/approval.js';
import {audit,diffFields} from '../services/audit.js';
import {loadRetirement,retirementSettings,retirementSettingBody,retirementListQuery} from '../services/retirement.js';
const router=Router();router.use(noStore,requirePermission('employees.read'));
router.get('/',validate(retirementListQuery,'query'),wrap(async(req,res)=>{
 res.json(await withTransaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return loadRetirement(db,req.query,{user:req.user});}));
}));
router.put('/settings',requirePermission('employees.manage'),validate(retirementSettingBody),wrap(async(req,res)=>{
 const saved=await withTransaction(async db=>{
  await db.query('SELECT id FROM retirement_settings WHERE id=1 FOR UPDATE');
  const before=await retirementSettings(db);
  if(before.version!==req.body.version)throw new HttpError(409,'Retirement age changed. Open Retirement again before saving.','conflict');
  if(before.retirementAge===req.body.retirementAge)return before;
  await db.query('UPDATE retirement_settings SET retirement_age=$1,version=version+1 WHERE id=1',[req.body.retirementAge]);
  const after=await retirementSettings(db);
  await audit(db,{actorId:req.user.id,action:'retirement_settings.update',entityType:'retirement_settings',entityId:1,details:{changes:diffFields(before,after,['retirementAge'])}});
  return after;
 });res.json(saved);
}));
export default router;
