import {hasPermission} from './permissions.js';
// Registry identifiers and field allowlists are server constants, never interpolated user input.
const HR=['audit.hr'],FIN=['audit.finance'],BOTH=['audit.hr','audit.finance'];
const salary=['basicMinor','allowanceMinor','allowanceTaxable','allowancePensionable','pensionApplies'];
export const AUDIT_RECORDS={
 vacancy:{table:'internal_vacancies',entity:'vacancy',domains:HR,read:'vacancies.manage',fields:['title','description','departmentId','positionId','closingOn','status']},
 vacancy_application:{table:'vacancy_applications',entity:'vacancy_application',domains:HR,read:'vacancies.review',fields:['vacancyId','status']},
 employee:{table:'employees',entity:'employee',domains:HR,read:'employees.manage',fields:['employeeCode','fullName','username','email','phone','departmentId','departmentName','positionId','positionName','jobTitle','startDate','employmentType','shiftId','status']},
 department:{table:'departments',entity:'department',domains:HR,read:'organization.manage',fields:['name']},
 position:{table:'positions',entity:'position',domains:HR,read:'organization.manage',fields:['name','departmentId',...salary]},
 salary_profile:{table:'employees',entity:'salary_profile',domains:HR,read:'salary_profiles.manage',fields:salary},
 attendance_record:{table:'attendance_records',entity:'attendance_record',domains:HR,read:'attendance.manage',fields:['status','checkInTime','checkOutTime','lateMinutes']},
 leave_request:{table:'leave_requests',entity:'leave_request',domains:HR,read:'leave.manage',fields:['employeeId','status','startDate','endDate','days','remarks','leaveTypeId']},
 payroll_period:{table:'payroll_periods',entity:'payroll_period',domains:BOTH,read:'payroll.read',fields:['month','employeeCount','from','to','paidOn','periodId','employeeId','basicMinor','allowanceMinor','grossMinor','incomeTaxMinor','employeePensionMinor','employerPensionMinor','otherDeductionsMinor','netMinor','taxableIncomeMinor','otherTaxMinor','pensionableMinor','employerCostMinor']},
 access_employee:{table:'employees',entity:'access_grant',domains:['audit.access'],read:'access.manage',fields:['userId','accessRole','bootstrap']},
 announcement:{table:'announcements',entity:'announcement',domains:HR,read:'announcements.manage',fields:['title','status','fromStatus','toStatus']},
 settlement_period:{table:'payroll_periods',entity:'payroll_settlement',domains:FIN,read:'settlements.manage',fields:['periodId','kind','amountMinor','paymentDate','reference']},
 payroll_settings:{table:'payroll_settings',entity:'payroll_settings',domains:BOTH,read:'payroll_settings.read',singleton:true,fields:['taxBase','pensionBase','employeePensionRate','companyPensionRate','absenceDeductionEnabled','unpaidLeaveDeductionEnabled','currencyCode']},
};
export const canReadAudit=(user,type)=>{const c=AUDIT_RECORDS[type];return !!c&&hasPermission(user,c.read)&&c.domains.some(p=>hasPermission(user,p));};
function value(v){
 if(v===null||['string','number','boolean'].includes(typeof v))return typeof v==='string'?v.slice(0,500):v;
 if(Array.isArray(v)&&v.length<=20&&v.every(x=>['string','number','boolean'].includes(typeof x)))return v;
 return '[Structured value omitted]';
}
export function auditChanges(details,fields){
 const out=[];const changes=details?.changes;
 if(changes&&typeof changes==='object')for(const key of fields){
  const c=changes[key];if(c&&typeof c==='object'&&(Object.hasOwn(c,'from')||Object.hasOwn(c,'to')))out.push({field:key,from:value(c.from??null),to:value(c.to??null)});
 }
 for(const key of fields)if(Object.hasOwn(details||{},key)&&!out.some(c=>c.field===key))out.push({field:key,value:value(details[key])});
 return out;
}
