import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditScope} from '../src/api/auditScope.js';
test('the persistent footer follows the active section in both management workspaces',()=>{
 for(const prefix of ['/hr','/finance']){
  assert.deepEqual(auditScope(prefix+'/payroll/company-costs'),{area:'payroll',label:'Company costs'});
  assert.deepEqual(auditScope(prefix+'/settings/payroll'),{area:'payroll_settings',label:'Payroll settings'});
  assert.deepEqual(auditScope(prefix+'/settings'),{area:'settings',label:'Settings'});
  assert.equal(auditScope(prefix+'/departments/12').area,'departments');
  assert.equal(auditScope(prefix+'/access-management').area,'access');
  assert.equal(auditScope(prefix+'/approvals').area,'approvals');
  assert.equal(auditScope(prefix+'/attendance/').area,'attendance');
  assert.equal(auditScope(prefix).area,'all');
 }
});
