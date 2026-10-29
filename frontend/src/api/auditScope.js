import {allowed} from './workspaces.js';
export function auditScope(pathname,user){
 const path=pathname.replace(/^\/(hr|finance)(?=\/|$)/,'').replace(/\/+$/,'');
 // Reports and workflow-only screens do not have an editable-record footer.
 if(path==='/payroll/company-costs'||path.startsWith('/payroll/company-costs/'))return null;
 const scopes=[['/settings/payroll','payroll_settings','Payroll settings',['payroll_settings.manage']],
 ['/employees','employees','Employees',['employees.manage']],['/departments','departments','Departments',['organization.manage']],
 ['/attendance','attendance','Attendance',['attendance.manage']],['/announcements','announcements','Announcements',['announcements.manage']],
 ['/settlements','settlements','Settlements',['settlements.manage']],['/access-management','access','Access Management',['access.manage']],
 ['/payroll','payroll','Payroll',['payroll.prepare','payroll.approve','payroll.pay']],['/settings','settings','Settings',['organization.manage']]];
 const scope=scopes.find(([prefix])=>path===prefix||path.startsWith(prefix+'/'));
 return scope&&scope[3].some(permission=>allowed(user,permission))?{area:scope[1],label:scope[2]}:null;
}
export const auditLabel=s=>String(s??'').replaceAll('_',' ').replaceAll('.',' ').replace(/([a-z])([A-Z])/g,'$1 $2');
