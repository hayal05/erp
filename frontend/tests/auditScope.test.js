import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditScope} from '../src/api/auditScope.js';
const admin={role:'hr',permissions:['access.manage','employees.manage','organization.manage','attendance.manage','announcements.manage','settlements.manage','payroll_settings.manage','payroll.prepare','payroll.approve','payroll.pay']};
test('the footer is hidden on dashboard, QR, leave, reports and workflow-only screens',()=>{
 for(const prefix of ['/hr','/finance'])for(const suffix of ['', '/', '/qr','/qr/','/leave','/leave/','/payroll/company-costs','/payroll/company-costs/','/approvals','/not-a-page']){
  assert.equal(auditScope(prefix+suffix,admin),null,prefix+suffix);
 }
});
test('editable sections retain the footer in both management workspaces',()=>{
 for(const prefix of ['/hr','/finance']){
  assert.deepEqual(auditScope(prefix+'/settings/payroll',admin),{area:'payroll_settings',label:'Payroll settings'});
  assert.deepEqual(auditScope(prefix+'/settings',admin),{area:'settings',label:'Settings'});
  assert.equal(auditScope(prefix+'/departments/12',admin).area,'departments');
  assert.equal(auditScope(prefix+'/access-management',admin).area,'access');
  assert.equal(auditScope(prefix+'/attendance/',admin).area,'attendance');
  assert.equal(auditScope(prefix+'/payroll',admin).area,'payroll');
 }
});
test('a page must be editable by the current user for its footer to appear',()=>{
 const hr={role:'employee',permissions:['payroll.read','payroll_settings.read','employees.manage','payroll.prepare']};
 const finance={role:'employee',permissions:['employees.read','attendance.read','payroll.read','payroll.approve','payroll_settings.manage']};
 assert.equal(auditScope('/hr/settings/payroll',hr),null);
 assert.equal(auditScope('/hr/employees',hr).area,'employees');
 assert.equal(auditScope('/hr/payroll',hr).area,'payroll');
 assert.equal(auditScope('/finance/employees',finance),null);
 assert.equal(auditScope('/finance/attendance',finance),null);
 assert.equal(auditScope('/finance/settings/payroll',finance).area,'payroll_settings');
 assert.equal(auditScope('/finance/payroll',finance).area,'payroll');
 assert.equal(auditScope('/hr/employees',{role:'employee',permissions:[]}),null);
 assert.equal(auditScope('/hr/employees',null),null);
});
