// Business labels for review screens; API routes stay internal.
export function changeLabel(method,path){
 const p=path.replace(/^\/api\//,'').split('/'),last=p.at(-1),id=p.find(v=>/^\d+$/.test(v));
 if(p[0]==='payroll')return last==='approve'?`Approve payroll #${id}`:last==='pay'?`Record payroll payment #${id}`:last==='regenerate'?`Regenerate payroll #${id}`:p.includes('entries')?`Update salary in payroll #${id}`:'Generate payroll';
 if(p[0]==='settlements')return `Record tax or pension settlement for payroll #${id}`;
 if(p[0]==='leave-admin')return 'Adjust leave entitlement';
 const resource=p.includes('positions')?'position':p.includes('holidays')?'holiday':({'employees':'employee','departments':'department','positions':'position','shifts':'shift','attendance-records':'attendance record','salary-profiles':'salary profile','announcements':'announcement','deductions':'deduction','payroll-settings':'payroll settings'}[p[0]]||'administrative record');
 const action=last==='activate'?'Activate':last==='deactivate'?'Deactivate':method==='DELETE'?'Delete':method==='POST'?'Create':'Update';
 return `${action} ${resource}${id?` #${id}`:''}`;
}
export const fieldLabel=key=>String(key).replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());
