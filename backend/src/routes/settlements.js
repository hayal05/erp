import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { requireHr } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { HttpError,wrap } from '../middleware/error.js';
import { validate,v } from '../middleware/validate.js';
import { pageSchema,pageOffset,pageResult } from '../services/sql.js';
import { idParams } from '../services/hrSchemas.js';
import { MAX_MINOR } from '../services/money.js';
import { companyDate } from '../services/attendance.js';
import { audit } from '../services/audit.js';
import { LIABILITY_CTE,safeAmount,toBalance,PAYMENT_COLUMNS,toPayment,paidPeriod } from '../services/settlements.js';
const router=Router();router.use(noStore,requireHr);
const kind = () => v.enum({required:true,values:['income_tax','pension']});
router.get('/',validate({...pageSchema,view:v.enum({values:['unsettled','all'],default:'unsettled'})},'query'),wrap(async(req,res)=>{
  const data=await withTransaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const where=req.query.view==='unsettled'?'WHERE tax_balance>0 OR pension_balance>0':'';
    const {rows}=await db.query(`${LIABILITY_CTE} SELECT *,to_char(period_month,'YYYY-MM') AS month,
      to_char(paid_on,'YYYY-MM-DD') AS paid_on FROM balances ${where} ORDER BY period_month DESC LIMIT $1 OFFSET $2`,[req.query.pageSize,pageOffset(req.query)]);
    const {rows:[count]}=await db.query(`${LIABILITY_CTE} SELECT count(*)::int AS total FROM balances ${where}`);
    const {rows:totals}=await db.query(`${LIABILITY_CTE} SELECT currency,sum(tax_balance) AS tax_balance,sum(pension_balance) AS pension_balance
      FROM balances GROUP BY currency ORDER BY currency`);
    return {...pageResult(rows.map(toBalance),req.query,count.total),summary:totals.map(r=>({currency:r.currency,incomeTaxBalanceMinor:safeAmount(r.tax_balance),pensionBalanceMinor:safeAmount(r.pension_balance)}))};
  });res.json(data);
}));
router.get('/:id/payments',validate(idParams,'params'),validate({...pageSchema,kind:kind()},'query'),wrap(async(req,res)=>{
  const result=await withTransaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await paidPeriod(db,req.params.id);
    const {rows}=await db.query(`SELECT ${PAYMENT_COLUMNS} FROM payroll_settlements s LEFT JOIN users u ON u.id=s.recorded_by_user_id
      WHERE s.period_id=$1 AND s.kind=$2 ORDER BY s.id DESC LIMIT $3 OFFSET $4`,[req.params.id,req.query.kind,req.query.pageSize,pageOffset(req.query)]);
    const {rows:[count]}=await db.query('SELECT count(*)::int AS total FROM payroll_settlements WHERE period_id=$1 AND kind=$2',[req.params.id,req.query.kind]);
    return pageResult(rows.map(toPayment),req.query,count.total);
  });res.json(result);
}));
router.get('/:id',validate(idParams,'params'),wrap(async(req,res)=>{
  const data=await withTransaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await paidPeriod(db,req.params.id);
    const {rows:[r]}=await db.query(`${LIABILITY_CTE} SELECT *,to_char(period_month,'YYYY-MM') AS month,
      to_char(paid_on,'YYYY-MM-DD') AS paid_on FROM balances WHERE id=$1`,[req.params.id]);
    return {...toBalance(r),today:companyDate()};
  });res.json(data);
}));
router.post('/:id/payments',validate(idParams,'params'),validate({kind:kind(),amountMinor:v.int({required:true,min:1,max:MAX_MINOR}),
  paymentDate:v.date({required:true}),reference:v.string({required:true,min:1,max:120}),notes:v.string({max:1000,default:''}),
  requestId:v.string({required:true,pattern:/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i})}),wrap(async(req,res)=>{
  const b=req.body;
  if(b.paymentDate>companyDate())throw new HttpError(422,'A recorded payment cannot be dated in the future','validation',{fields:{paymentDate:'Choose today or an earlier date'}});
  const result=await withTransaction(async db=>{
    await paidPeriod(db,req.params.id,{lock:true});
    // A retry of the same request returns its original receipt, never a second payment.
    const {rows:[existing]}=await db.query('SELECT * FROM payroll_settlements WHERE request_id=$1',[b.requestId]);
    if(existing){
      const same=Number(existing.period_id)===req.params.id&&existing.kind===b.kind&&Number(existing.amount_minor)===b.amountMinor
        && String(existing.payment_date instanceof Date?existing.payment_date.toISOString().slice(0,10):existing.payment_date)===b.paymentDate
        &&existing.reference===b.reference&&existing.notes===b.notes;
      if(!same)throw new HttpError(409,'This payment request was already used. Refresh before recording another payment.','conflict');
      return {id:existing.id,reused:true};
    }
    const {rows:[balance]}=await db.query(`${LIABILITY_CTE} SELECT * FROM balances WHERE id=$1`,[req.params.id]);
    const remaining=BigInt(b.kind==='income_tax'?balance.tax_balance:balance.pension_balance);
    if(BigInt(b.amountMinor)>remaining)throw new HttpError(409,'Payment exceeds the remaining balance. Refresh to see the latest payable.','overpayment');
    const {rows:[r]}=await db.query(`INSERT INTO payroll_settlements(period_id,kind,amount_minor,payment_date,reference,notes,request_id,recorded_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[req.params.id,b.kind,b.amountMinor,b.paymentDate,b.reference,b.notes,b.requestId,req.user.id]);
    await audit(db,{actorId:req.user.id,action:'settlement.record',entityType:'payroll_settlement',entityId:r.id,
      details:{periodId:req.params.id,kind:b.kind,amountMinor:b.amountMinor,paymentDate:b.paymentDate,reference:b.reference}});
    return {id:r.id,reused:false};
  });
  res.status(result.reused?200:201).json({id:Number(result.id),reused:result.reused});
}));
export default router;
