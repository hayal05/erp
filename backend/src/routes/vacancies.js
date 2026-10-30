import {Router} from 'express';
import {withTransaction} from '../db/pool.js';
import {requirePermission,requireEmployee} from '../middleware/auth.js';
import {noStore} from '../middleware/noStore.js';
import {HttpError,wrap} from '../middleware/error.js';
import {approvalWrap} from '../middleware/approval.js';
import {validate,v} from '../middleware/validate.js';
import {idParams} from '../services/hrSchemas.js';
import {pageSchema,pageOffset,pageResult} from '../services/sql.js';
import {hasPermission} from '../services/permissions.js';
import {audit,diffFields} from '../services/audit.js';
import {companyDate} from '../services/attendance.js';
import {approvalTransaction} from '../services/approvalExecution.js';
import {loadVacancies,applyForVacancy,vacancyColumns,vacancyFrom,vacancyOutput} from '../services/vacancies.js';
import {config} from '../config.js';
const router=Router();router.use(noStore,requirePermission('vacancies.read'));
const statuses=['draft','open','closed'];
const schema={title:v.string({required:true,min:1,max:160}),description:v.string({max:5000,default:''}),departmentId:v.int({required:true,min:1}),
 positionId:v.int({required:true,min:1}),closingOn:v.date({required:true}),status:v.enum({required:true,values:statuses})};
async function checkPosting(db,b){
 if(b.status==='open'&&b.closingOn<companyDate())throw new HttpError(422,'Closing date must be today or later','validation',{fields:{closingOn:'Choose today or a future date'}});
 const {rows}=await db.query('SELECT id FROM positions WHERE id=$1 AND department_id=$2 FOR SHARE',[b.positionId,b.departmentId]);
 if(!rows.length)throw new HttpError(422,'Choose a position in this department','validation',{fields:{positionId:'Position does not belong to this department'}});
}
router.get('/',validate({...pageSchema,view:v.enum({values:['open','mine','manage'],default:'open'}),status:v.enum({values:statuses})},'query'),wrap(async(req,res)=>{
 if(req.query.view==='manage'&&!hasPermission(req.user,'vacancies.admin_read'))throw new HttpError(403,'You cannot manage vacancies','forbidden');
 const result=await withTransaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return loadVacancies(db,req.user,req.query);});res.json(result);
}));
router.post('/',requirePermission('vacancies.manage'),validate(schema),approvalWrap(async(req,res)=>{
 const b=req.body;
 const saved=await withTransaction(async db=>{
  await checkPosting(db,b);
  const {rows:[row]}=await db.query(`INSERT INTO internal_vacancies(title,description,department_id,position_id,closing_on,status,published_at,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $6='open' THEN now() ELSE NULL END,$7) RETURNING id`,[b.title,b.description,b.departmentId,b.positionId,b.closingOn,b.status,req.user.id]);
  await audit(db,{actorId:req.user.id,action:'vacancy.create',entityType:'vacancy',entityId:row.id,details:b});return {id:Number(row.id)};
 });res.status(201).json(saved);
}));
router.put('/:id',requirePermission('vacancies.manage'),validate(idParams,'params'),validate({...schema,version:v.int({required:true,min:1})}),approvalWrap(async(req,res)=>{
 const b=req.body;
 await withTransaction(async db=>{
  const {rows:[before]}=await db.query("SELECT *,to_char(closing_on,'YYYY-MM-DD') AS closing_date FROM internal_vacancies WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!before)throw new HttpError(404,'Vacancy not found','not_found');
  if(before.version!==b.version)throw new HttpError(409,'This vacancy changed. Reopen it before saving.','conflict');
  if(before.published_at&&b.status==='draft')throw new HttpError(409,'An opened vacancy cannot return to draft','conflict');
  await checkPosting(db,b);
  if(before.title!==b.title||Number(before.position_id)!==b.positionId||Number(before.department_id)!==b.departmentId){
   const {rows}=await db.query('SELECT 1 FROM vacancy_applications WHERE vacancy_id=$1 LIMIT 1',[req.params.id]);
   if(rows.length)throw new HttpError(409,'Create a new vacancy to change its title or position after applications arrive','conflict');
  }
  await db.query(`UPDATE internal_vacancies SET title=$2,description=$3,department_id=$4,position_id=$5,closing_on=$6,status=$7,
   published_at=CASE WHEN $7='open' THEN COALESCE(published_at,now()) ELSE published_at END,version=version+1 WHERE id=$1`,[req.params.id,b.title,b.description,b.departmentId,b.positionId,b.closingOn,b.status]);
  const old={title:before.title,description:before.description,departmentId:Number(before.department_id),positionId:Number(before.position_id),closingOn:before.closing_date,status:before.status};
  await audit(db,{actorId:req.user.id,action:'vacancy.update',entityType:'vacancy',entityId:req.params.id,details:{changes:diffFields(old,b,Object.keys(schema))}});
 });res.json({id:req.params.id});
}));
// Self-service apply is immediate. Identity and profile always come from the session/database.
router.post('/:id/apply',requireEmployee,validate(idParams,'params'),validate({}),wrap(async(req,res)=>{
 const saved=await withTransaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');return applyForVacancy(db,req.user,req.params.id);});
 res.status(201).json(saved);
}));
router.get('/:id/applications',requirePermission('vacancies.review'),validate(idParams,'params'),validate(pageSchema,'query'),wrap(async(req,res)=>{
 const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows:[vacancy]}=await db.query(`SELECT ${vacancyColumns} ${vacancyFrom} WHERE v.id=$2`,[config.company.timezone,req.params.id]);
  if(!vacancy)throw new HttpError(404,'Vacancy not found','not_found');
  const {rows}=await db.query(`SELECT a.id,a.employee_id AS "employeeId",a.profile_snapshot->>'fullName' AS "fullName",
   a.profile_snapshot->>'employeeCode' AS "employeeCode",a.status,a.version,a.applied_at AS "appliedAt",a.reviewed_at AS "reviewedAt",u.username AS "reviewedBy"
   FROM vacancy_applications a LEFT JOIN users u ON u.id=a.reviewed_by_user_id WHERE a.vacancy_id=$1 ORDER BY a.applied_at DESC,a.id DESC LIMIT $2 OFFSET $3`,[req.params.id,req.query.pageSize,pageOffset(req.query)]);
  const {rows:[count]}=await db.query('SELECT count(*)::int total FROM vacancy_applications WHERE vacancy_id=$1',[req.params.id]);
  return {...pageResult(rows.map(r=>({...r,id:Number(r.id),employeeId:Number(r.employeeId)})),req.query,count.total),vacancy:vacancyOutput(vacancy)};
 });res.json(result);
}));
router.get('/:id/applications/:applicationId',requirePermission('vacancies.review'),validate({...idParams,applicationId:v.int({required:true,min:1})},'params'),wrap(async(req,res)=>{
 const row=await withTransaction(async db=>{
  const {rows:[r]}=await db.query(`SELECT id,profile_snapshot AS profile,status,version,applied_at AS "appliedAt" FROM vacancy_applications WHERE id=$1 AND vacancy_id=$2`,[req.params.applicationId,req.params.id]);
  if(!r)throw new HttpError(404,'Application not found','not_found');return {...r,id:Number(r.id)};
 });res.json(row);
}));
router.patch('/:id/applications/:applicationId',requirePermission('vacancies.review'),validate({...idParams,applicationId:v.int({required:true,min:1})},'params'),validate({status:v.enum({required:true,values:['shortlisted','selected','rejected']}),version:v.int({required:true,min:1})}),approvalWrap(async(req,res)=>{
 await withTransaction(async db=>{
  const {rows:[before]}=await db.query('SELECT * FROM vacancy_applications WHERE id=$1 AND vacancy_id=$2 FOR UPDATE',[req.params.applicationId,req.params.id]);
  if(!before)throw new HttpError(404,'Application not found','not_found');
  if(before.version!==req.body.version||before.status===req.body.status)throw new HttpError(409,'This application changed. Reopen it before reviewing.','conflict');
  const reviewerId=approvalTransaction.getStore()?.reviewerId??req.user.id;
  await db.query('UPDATE vacancy_applications SET status=$2,version=version+1,reviewed_by_user_id=$3,reviewed_at=now() WHERE id=$1',[before.id,req.body.status,reviewerId]);
  await audit(db,{actorId:req.user.id,action:'vacancy.application.review',entityType:'vacancy_application',entityId:before.id,details:{vacancyId:req.params.id,changes:{status:{from:before.status,to:req.body.status}}}});
 });res.json({id:req.params.applicationId,status:req.body.status});
}));
export default router;
