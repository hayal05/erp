// Presentation checks mirror server-provided capabilities; the API remains authoritative.
export function allowed(user,permission){
 if(typeof permission!=='string')return false;
 if(!['hr','employee'].includes(user?.role))return false;
 if(Array.isArray(user?.permissions))return user.permissions.includes(permission);
 return user?.role==='hr'&&!permission.startsWith('self.'); // older session response during rollout
}
export const isAdmin=user=>allowed(user,'access.manage');
export const canUseWorkspace=(user,area)=>area==='portal'?user?.role==='employee'
 :area==='finance'?allowed(user,'payroll.approve'):area==='hr'?(isAdmin(user)||allowed(user,'employees.manage')):false;
export function workspaceOptions(user){
 return [canUseWorkspace(user,'portal')&&{key:'portal',label:'My employee portal',to:'/portal'},
  canUseWorkspace(user,'hr')&&{key:'hr',label:isAdmin(user)?'Admin workspace':'HR workspace',to:'/hr'},
  canUseWorkspace(user,'finance')&&{key:'finance',label:'Finance workspace',to:'/finance'}].filter(Boolean);
}
export const workspaceArea=pathname=>pathname==='/finance'||pathname.startsWith('/finance/')?'finance':'hr';
export const workspacePath=(path,pathname)=>workspaceArea(pathname)==='finance'?path.replace(/^\/hr(?=\/|$)/,'/finance'):path;
const HR_PATHS=[['/hr/vacancies','vacancies.admin_read'],['/hr/approvals','approvals.read'],['/hr/access-management','access.read'],['/hr/payroll/company-costs','company_costs.read'],['/hr/settings/payroll','payroll_settings.read'],
 ['/hr/employees','employees.read'],['/hr/departments','organization.read'],['/hr/attendance','attendance.read'],['/hr/qr','attendance.qr.read'],
 ['/hr/leave','leave.read'],['/hr/payroll','payroll.read'],['/hr/settlements','settlements.read'],['/hr/announcements','announcements.admin_read'],['/hr/settings','organization.read']];
export function canOpenPath(user,path){
 if(path==='/portal'||path.startsWith('/portal/'))return canUseWorkspace(user,'portal');
 const area=workspaceArea(path);if(!canUseWorkspace(user,area))return false;
 const normalized=path.replace(/^\/finance(?=\/|$)/,'/hr');
 if(normalized==='/hr'||normalized==='/hr/')return true;
 const match=HR_PATHS.find(([prefix])=>normalized===prefix||normalized.startsWith(prefix+'/'));
 return !!match&&allowed(user,match[1]);
}
