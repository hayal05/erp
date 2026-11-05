import {HttpError} from '../middleware/error.js';
import {assertEmployeeScope,permissionScope} from './accessScope.js';
export const EMPLOYEE_OPERATIONS=[
 {permission:'salary_profiles.manage',area:'hr',pattern:/^\/api\/salary-profiles\/(\d+)$/,direct:true,pathSql:"'/api/salary-profiles/'||se.id::text"},
 {permission:'leave.manage',area:'hr',pattern:/^\/api\/leave-admin\/balances$/,body:true,pathSql:"'/api/leave-admin/balances'"},
 {permission:'deductions.manage',area:'finance',pattern:/^\/api\/deductions$/,body:true,pathSql:"'/api/deductions'"},
 {permission:'deductions.manage',area:'finance',pattern:/^\/api\/deductions\/(\d+)$/,table:'deduction_items',pathSql:"'/api/deductions/'||sr.id::text"},
 {permission:'payroll.prepare',area:'hr',pattern:/^\/api\/payroll\/periods\/(\d+)\/entries\/(\d+)$/,table:'payroll_entries',idGroup:2,parentColumn:'period_id',pathSql:"'/api/payroll/periods/'||sr.period_id::text||'/entries/'||sr.id::text"},
 {permission:'vacancies.review',area:'hr',pattern:/^\/api\/vacancies\/(\d+)\/applications\/(\d+)$/,table:'vacancy_applications',idGroup:2,parentColumn:'vacancy_id',pathSql:"'/api/vacancies/'||sr.vacancy_id::text||'/applications/'||sr.id::text"},
];
export async function assertRecordEmployeeScope(db,user,permission,table,id,parent){
 if(!['deduction_items','payroll_entries','vacancy_applications','leave_requests','leave_balances','employee_attachments'].includes(table))throw new Error('Invalid scoped record table');
 const args=[id],extra=parent?` AND ${parent.column}=$2`:'';
 if(parent){if(!['period_id','vacancy_id'].includes(parent.column))throw new Error('Invalid parent column');args.push(parent.id);}
 const {rows:[record]}=await db.query(`SELECT employee_id FROM ${table} WHERE id=$1${extra}`,args);
 if(!record)throw new HttpError(404,'Record not found','not_found');
 await assertEmployeeScope(db,user,permission,record.employee_id);return Number(record.employee_id);
}
export async function assertEmployeeActivityScope(db,user,permission,path,body={}){
 if(permissionScope(user,permission)===null)return;
 const operation=EMPLOYEE_OPERATIONS.find(o=>o.permission===permission&&o.pattern.test(path));
 if(!operation)throw new HttpError(403,'This operation requires All employees scope','forbidden');
 const match=path.match(operation.pattern);
 if(operation.table)return assertRecordEmployeeScope(db,user,permission,operation.table,Number(match[operation.idGroup??1]),operation.parentColumn?{column:operation.parentColumn,id:Number(match[1])}:null);
 return assertEmployeeScope(db,user,permission,operation.body?body.employeeId:Number(match[1]));
}
