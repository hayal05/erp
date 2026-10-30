import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceOptions,canOpenPath,workspacePath,canUseWorkspace} from '../src/api/workspaces.js';
import {redirectTarget,homePath} from '../src/api/paths.js';
const employee={role:'employee',permissions:['self.profile']};
const reads=['dashboard.read','employees.read','organization.read','attendance.read','attendance.qr.read','leave.read','announcements.admin_read','settlements.read','access.read','company_costs.read'];
const hr={role:'employee',permissions:[...reads,'employees.manage','organization.manage','attendance.manage','attendance.qr','leave.manage','announcements.manage','payroll.read','payroll_settings.read']};
const finance={role:'employee',permissions:[...reads,'payroll.approve','payroll.read','company_costs.read','settlements.manage','payroll_settings.read']};
const both={role:'employee',permissions:[...hr.permissions,...finance.permissions]};
test('plain employees see only their own portal; additional grants preserve that portal',()=>{
 assert.deepEqual(workspaceOptions(employee).map(x=>x.key),['portal']);
 assert.deepEqual(workspaceOptions(hr).map(x=>x.key),['portal','hr']);
 assert.deepEqual(workspaceOptions(finance).map(x=>x.key),['portal','finance']);
 assert.deepEqual(workspaceOptions(both).map(x=>x.key),['portal','hr','finance']);
 assert.equal(homePath(both),'/portal');
});
test('HR and Finance deep links honor permitted areas and reject wrong workspaces',()=>{
 assert.equal(redirectTarget('/hr/attendance',hr),'/hr/attendance');
 assert.equal(redirectTarget('/finance/payroll?month=2026-10',finance),'/finance/payroll?month=2026-10');
 assert.equal(redirectTarget('/hr/attendance',finance),'/portal');
 assert.equal(redirectTarget('/finance/payroll',hr),'/portal');
 assert.equal(canOpenPath(hr,'/hr/settlements'),true);
 assert.equal(canOpenPath(hr,'/hr/access-management'),true);
 assert.equal(canOpenPath(finance,'/finance/employees'),true);
 assert.equal(canOpenPath(finance,'/finance/settings'),true);
 assert.equal(canOpenPath(finance,'/finance/settings/payroll'),true);
 assert.equal(canOpenPath(finance,'/finance/payroll/company-costs'),true);
});
test('Admin keeps management access without inventing an employee identity',()=>{
 const root={role:'hr',permissions:['access.manage','payroll.approve','payroll.read']};
 assert.deepEqual(workspaceOptions(root).map(x=>x.key),['hr','finance']);
 assert.equal(homePath(root),'/hr');assert.equal(canUseWorkspace(root,'portal'),false);
});
test('revocation and updated permissions remove workspace and page access',()=>{
 assert.equal(canOpenPath(finance,'/finance/payroll'),true);
 assert.equal(canOpenPath(employee,'/finance/payroll'),false);
 assert.deepEqual(workspaceOptions({role:'hr',permissions:[]}),[]);
 assert.equal(canOpenPath({role:'unknown',permissions:finance.permissions},'/finance/payroll'),false);
});
test('internal links retain finance workspace; redirects reject hostile URLs',()=>{
 assert.equal(workspacePath('/hr/payroll/company-costs','/finance/payroll'),'/finance/payroll/company-costs');
 assert.equal(workspacePath('/hr/settings/payroll','/hr/payroll'),'/hr/settings/payroll');
 for(const path of ['//evil.test','/finance\\bad','/financex/payroll','https://evil.test/finance','/hr/access-management'])assert.equal(redirectTarget(path,finance),'/portal');
});


test('the approval inbox is available in HR and Finance workspaces and excluded from plain employee access',()=>{
 assert.equal(canOpenPath({...hr,permissions:[...hr.permissions,'approvals.read']},'/hr/approvals'),true);
 assert.equal(canOpenPath({...finance,permissions:[...finance.permissions,'approvals.read']},'/finance/approvals'),true);
 assert.equal(canOpenPath(employee,'/hr/approvals'),false);
 assert.equal(canOpenPath(employee,'/finance/approvals'),false);
 assert.equal(workspacePath('/hr/approvals','/finance/payroll'),'/finance/approvals');
});


test('both administrative roles can open every sidebar section in their own workspace',()=>{
 for(const [user,prefix]of [[hr,'/hr'],[finance,'/finance']])for(const suffix of ['/employees','/departments/1','/attendance','/qr','/leave','/announcements','/settings','/settings/payroll','/payroll/company-costs','/settlements','/access-management'])assert.equal(canOpenPath(user,prefix+suffix),true,prefix+suffix);
});
