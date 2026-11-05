import {scopeSql,permissionScope,assertEmployeeScope} from './accessScope.js';
import {HttpError} from '../middleware/error.js';
export const EMPLOYEE_AUDIT={
 employee:{permission:'employees.manage',domain:'audit.hr'},employee_attachment:{permission:'employees.manage',domain:'audit.hr',table:'employee_attachments'},
 salary_profile:{permission:'salary_profiles.manage',domain:'audit.hr'},leave_request:{permission:'leave.manage',domain:'audit.hr',table:'leave_requests'},
 leave_balance:{permission:'leave.manage',domain:'audit.hr',table:'leave_balances'},deduction_item:{permission:'deductions.manage',domain:'audit.finance',table:'deduction_items',deleted:true},
 vacancy_application:{permission:'vacancies.review',domain:'audit.hr',table:'vacancy_applications'},payroll_entry:{permission:'payroll.read',domain:'audit.hr',table:'payroll_entries',deleted:true},
};
export function employeeAuditSql(user,args,alias='a'){
 return Object.entries(EMPLOYEE_AUDIT).map(([type,c])=>{
  if(permissionScope(user,c.permission)===null&&(type==='payroll_entry'||permissionScope(user,c.domain)===null))return 'TRUE';
  const scope=scopeSql(user,c.permission,'se',args);
  const domain=type==='payroll_entry'?'TRUE':scopeSql(user,c.domain,'se',args);
  const match=c.table?`EXISTS(SELECT 1 FROM ${c.table} sr WHERE sr.id::text=${alias}.entity_id AND sr.employee_id=se.id)${c.deleted?` OR ${alias}.details->>'employeeId'=se.id::text`:''}`:`se.id::text=${alias}.entity_id`;
  return `(${alias}.entity_type<>'${type}' OR EXISTS(SELECT 1 FROM employees se WHERE (${match}) AND ${scope} AND ${domain}))`;
 }).join(' AND ')+(permissionScope(user,'payroll.read')===null?'':` AND ${alias}.entity_type<>'payroll_period'`);
}
export async function assertEmployeeAuditScope(db,user,type,id){
 if(type==='payroll_period'&&permissionScope(user,'payroll.read')!==null)throw new HttpError(403,'Company-wide payroll audit requires All employees scope','forbidden');
 const c=EMPLOYEE_AUDIT[type];if(!c)return;
 const employeeId=c.table?(await db.query(`SELECT employee_id FROM ${c.table} WHERE id=$1`,[id])).rows[0]?.employee_id:id;
 await assertEmployeeScope(db,user,c.permission,employeeId);
 if(type!=='payroll_entry')await assertEmployeeScope(db,user,c.domain,employeeId);
}
