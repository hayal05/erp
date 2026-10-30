import {Router} from 'express';
import {withTransaction} from '../db/pool.js';
import {wrap} from '../middleware/error.js';
import {requirePermission} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {loadDashboard} from '../services/dashboard.js';
const router=Router();
router.use(noStore,requirePermission('dashboard.read'));
router.get('/',wrap(async(req,res)=>{
 res.json(await withTransaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return loadDashboard(db);}));
}));
export default router;
