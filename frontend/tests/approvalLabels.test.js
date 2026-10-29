import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeLabel,fieldLabel} from '../src/api/approvalLabels.js';
test('review descriptions explain business actions and preserve the record reference',()=>{
 assert.equal(changeLabel('PATCH','/api/employees/8'),'Update employee #8');
 assert.equal(changeLabel('POST','/api/payroll/periods/7/regenerate'),'Regenerate payroll #7');
 assert.equal(changeLabel('POST','/api/payroll/periods/7/approve'),'Approve payroll #7');
 assert.equal(changeLabel('POST','/api/settlements/7/payments'),'Record tax or pension settlement for payroll #7');
 assert.equal(fieldLabel('allowanceTaxable'),'Allowance Taxable');
});
