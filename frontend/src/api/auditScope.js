export function auditScope(pathname){
 const path=pathname.replace(/^\/(hr|finance)(?=\/|$)/,'').replace(/\/+$/,'');
 const scopes=[['/payroll/company-costs','payroll','Company costs'],['/settings/payroll','payroll_settings','Payroll settings'],
 ['/employees','employees','Employees'],['/departments','departments','Departments'],['/attendance','attendance','Attendance'],
 ['/leave','leave','Leave'],['/announcements','announcements','Announcements'],['/settlements','settlements','Settlements'],
 ['/access-management','access','Access Management'],['/approvals','approvals','Approvals'],['/payroll','payroll','Payroll'],['/settings','settings','Settings']];
 const scope=scopes.find(([prefix])=>path===prefix||path.startsWith(prefix+'/'));
 return scope?{area:scope[1],label:scope[2]}:{area:'all',label:'Workspace'};
}
export const auditLabel=s=>String(s??'').replaceAll('_',' ').replaceAll('.',' ').replace(/([a-z])([A-Z])/g,'$1 $2');
