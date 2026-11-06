import { readCompanyCosts } from '../services/companyCosts.js';
import {scopeSql,permissionScope} from '../services/accessScope.js';
import {toEntry} from '../services/payrollDraft.js';
import {idParams} from '../services/hrSchemas.js';
import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { wrap, HttpError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { pageSchema, pageOffset, pageResult } from '../services/sql.js';
const router = Router();
router.use(noStore, requirePermission('company_costs.read'));
router.get('/', validate(pageSchema, 'query'), wrap(async (req, res) => {
  res.json(await readCompanyCosts(req.user, req.query));
}));
router.get('/:id/entries',validate(idParams,'params'),validate(pageSchema,'query'),wrap(async(req,res)=>{
 const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const args=[req.params.id],scope=scopeSql(req.user,'company_costs.read','se',args);
  const from=`FROM payroll_entries pe JOIN payroll_periods p ON p.id=pe.period_id JOIN employees se ON se.id=pe.employee_id WHERE p.id=$1 AND p.status='paid' AND ${scope}`;
  const {rows:[count]}=await db.query(`SELECT count(*)::int total ${from}`,args);
  if(!count.total&&permissionScope(req.user,'company_costs.read')!==null)throw new HttpError(404,'Payroll period not found','not_found');
  const {rows}=await db.query(`SELECT pe.* ${from} ORDER BY pe.employee_id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,req.query.pageSize,pageOffset(req.query)]);
  return pageResult(rows.map(toEntry),req.query,count.total);
 });res.json(result);
}));
export default router;
