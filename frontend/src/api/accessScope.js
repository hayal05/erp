export function hasAllEmployeeScope(user,permission){
 const roles=user?.accessRoles??[];
 if(roles.includes('admin')||permission==='payroll.prepare'&&roles.includes('hr'))return true;
 return (user?.customGrants??[]).some(g=>g.scopeType==='all'&&g.permissions?.includes(permission));
}
