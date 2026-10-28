import {Router} from 'express';
import {withTransaction} from '../db/pool.js';
import {wrap} from '../middleware/error.js';
import {requireEmployee} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {validate} from '../middleware/validate.js';
import {idParams} from '../services/hrSchemas.js';
import {pageSchema} from '../services/sql.js';
import {listOwnPayslips,loadOwnPayslip} from '../services/payslips.js';
const router=Router();
router.use(noStore,requireEmployee);
const readSnapshot=(fn)=>withTransaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return fn(db);});
router.get('/',validate(pageSchema,'query'),wrap(async(req,res)=>{
 res.json(await readSnapshot(db=>listOwnPayslips(db,{userId:req.user.id,...req.query})));
}));
router.get('/:id',validate(idParams,'params'),wrap(async(req,res)=>{
 res.json(await readSnapshot(db=>loadOwnPayslip(db,{userId:req.user.id,entryId:req.params.id})));
}));
export default router;
