// Fixed activity identifiers. Role names never imply powers; access.manage is never delegable.
export const ACTIVITY_GROUPS=[
 ['People',[['employees.read','View employee profiles and retirement'],['employees.manage','Manage employees and attachments (retirement age with All employees scope)'],['salary_profiles.manage','Manage salary profiles']]],
 ['Attendance',[['attendance.read','View attendance and selfies'],['attendance.manage','Correct attendance'],['attendance.qr.read','View QR attendance'],['attendance.qr','Generate QR codes'],['attendance.qr.lock','Lock and unlock own QR screen']]],
 ['Organization',[['organization.read','View scoped departments and shared schedules'],['organization.manage','Manage departments, positions, holidays and schedules']]],
 ['Leave',[['leave.read','View leave'],['leave.manage','Review leave and adjust balances']]],
 ['Payroll',[['payroll.read','View payroll'],['payroll.prepare','Edit payroll entries (generate and regenerate with All employees scope)'],['payroll.approve','Submit payroll approval'],['payroll.pay','Record payroll payment'],['payroll_settings.read','View shared payroll settings'],['payroll_settings.manage','Change payroll settings'],['deductions.read','View deductions'],['deductions.manage','Manage deductions'],['company_costs.read','View company costs'],['settlements.read','View settlements'],['settlements.manage','Record settlements']]],
 ['Communication',[['announcements.admin_read','View shared company announcements'],['announcements.manage','Manage announcements'],['vacancies.admin_read','View internal vacancies and applications'],['vacancies.manage','Post and edit vacancies'],['vacancies.review','Review applications']]],
 ['Review and reports',[['dashboard.read','View dashboard for scoped employees'],['approvals.read','View permitted approval requests'],['changes.hr.approve','Approve another person’s permitted HR changes'],['changes.finance.approve','Approve another person’s permitted Finance changes'],['audit.hr','View permitted HR audit records'],['audit.finance','View permitted Finance audit records'],['access.read','View access assignments']]]
];
export const ACTIVITY_IDS=ACTIVITY_GROUPS.flatMap(([,items])=>items.map(([id])=>id));
export const SCOPED_ACTIVITIES=['announcements.admin_read','salary_profiles.manage','leave.read','leave.manage','deductions.read','deductions.manage','payroll.read','payroll.prepare','company_costs.read','dashboard.read','access.read','organization.read','payroll_settings.read','vacancies.read','vacancies.admin_read','vacancies.review','changes.finance.approve','audit.finance','employees.manage','employees.read','attendance.read','attendance.manage','attendance.qr.read','attendance.qr','attendance.qr.lock','approvals.read','changes.hr.approve','audit.hr'];
export const ACTIVITY_DEPENDENCIES={
 'leave.read':['employees.read','organization.read'],
 'deductions.read':['employees.read','payroll_settings.read'],
 'payroll.read':['employees.read'],
 'company_costs.read':['payroll.read'],
 'vacancies.admin_read':['vacancies.read'],
 'employees.manage':['employees.read','audit.hr','approvals.read'],
 'salary_profiles.manage':['payroll.read','employees.read','payroll_settings.read','audit.hr','approvals.read'],
 'organization.manage':['organization.read','audit.hr','approvals.read'],
 'attendance.manage':['attendance.read','audit.hr','approvals.read'],
 'attendance.qr':['attendance.qr.read'],'attendance.qr.lock':['attendance.qr.read'],
 'leave.manage':['leave.read','employees.read','organization.read','audit.hr','approvals.read'],
 'payroll.prepare':['payroll.read','audit.hr','approvals.read'],
 'payroll.approve':['payroll.read','audit.finance','approvals.read'],
 'payroll.pay':['payroll.read','audit.finance','approvals.read'],
 'payroll_settings.manage':['payroll_settings.read','audit.finance','approvals.read'],
 'deductions.manage':['deductions.read','employees.read','audit.finance','approvals.read'],
 'settlements.manage':['settlements.read','audit.finance','approvals.read'],
 'vacancies.manage':['vacancies.admin_read','vacancies.read','organization.read','audit.hr','approvals.read'],
 'vacancies.review':['vacancies.admin_read','vacancies.read','audit.hr','approvals.read'],
 'announcements.manage':['announcements.admin_read','announcements.read','audit.hr','approvals.read'],
 'changes.hr.approve':['approvals.read'],'changes.finance.approve':['approvals.read']
};
export function expandActivities(ids){const out=new Set(ids);for(const id of out)for(const required of ACTIVITY_DEPENDENCIES[id]??[])out.add(required);return [...out].sort();}

// Scope applies to each selected activity. Unsupported company-wide operations never
// inherit a department grant, nor do their implicit dependencies survive on their own.
export function activityScopePlan(activities,scopeType='all'){
 const included=scopeType==='all'?activities:activities.filter(id=>expandActivities([id]).every(p=>SCOPED_ACTIVITIES.includes(p)));
 return {permissions:expandActivities(included),excluded:activities.filter(id=>!included.includes(id))};
}
