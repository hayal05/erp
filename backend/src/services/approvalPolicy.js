// Only fixed administrative operations may enter the queue. Daily attendance, QR,
// personal profiles/passwords and existing leave decisions do not use this wrapper.
const rules=[
 ['hr','employees.manage',/^\/api\/employees(?:\/\d+(?:\/(?:activate|deactivate))?)?$/,['employees','users','salary_profiles','positions','departments','shifts']],
 ['hr','organization.manage',/^\/api\/(?:departments(?:\/\d+(?:\/positions)?)?|positions\/\d+|shifts(?:\/\d+)?|settings\/holidays(?:\/\d+)?)$/,['departments','positions','employees','shifts','holidays']],
 ['hr','salary_profiles.manage',/^\/api\/salary-profiles\/\d+$/,['salary_profiles','employees']],
 ['hr','attendance.manage',/^\/api\/attendance-records\/\d+$/,['attendance_records','employees','shifts']],
 ['hr','leave.manage',/^\/api\/leave-admin\/balances$/,['leave_balances','leave_types','employees']],
 ['hr','announcements.manage',/^\/api\/announcements(?:\/\d+)?$/,['announcements']],
 ['finance','payroll_settings.manage',/^\/api\/payroll-settings\/(?:brackets|calculation|attendance-deductions|other-taxes(?:\/\d+)?)$/,['payroll_settings','income_tax_brackets','other_taxes']],
 ['finance','deductions.manage',/^\/api\/deductions(?:\/\d+)?$/,['deduction_items','payroll_periods']],
 ['finance','settlements.manage',/^\/api\/settlements\/\d+\/payments$/,['payroll_settlements','payroll_periods']],
 ['finance','payroll.approve',/^\/api\/payroll\/periods\/\d+\/approve$/,['payroll_periods','payroll_entries','payroll_entry_items','salary_profiles','payroll_settings','income_tax_brackets','other_taxes','deduction_items','attendance_records','leave_requests','leave_types','employees','shifts','holidays']],
 ['finance','payroll.pay',/^\/api\/payroll\/periods\/\d+\/pay$/,['payroll_periods','payroll_entries']],
 ['hr','payroll.prepare',/^\/api\/payroll\/periods(?:\/\d+\/(?:regenerate|entries\/\d+))?$/,['payroll_periods','payroll_entries','payroll_entry_items','salary_profiles','payroll_settings','income_tax_brackets','other_taxes','deduction_items','attendance_records','leave_requests','leave_types','employees','shifts','holidays']],
];
export function approvalPolicy(method,path){
 if(!['POST','PUT','PATCH','DELETE'].includes(method))return null;
 const found=rules.find(r=>r[2].test(path));return found?{department:found[0],permission:found[1],tables:found[3]}:null;
}
export const leaveDecision=(method,path)=>method==='POST'&&/^\/api\/leave-admin\/requests\/\d+\/(approve|reject)$/.test(path);
