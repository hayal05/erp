import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_ROLES, PERMISSIONS, ROLE_PERMISSIONS, permissionsFor, hasPermission } from '../src/services/permissions.js';
import { GUARD, requirePermission, requireHr, requireEmployee } from '../src/middleware/auth.js';
const person = (...accessRoles) => ({ id: 1, role: 'employee', accessRoles });
const run = (guard, user, extra = {}) => {
  let result;
  guard({ user, session: { locked: false }, ...extra }, {}, error => { result = error || null; });
  return result;
};
test('all grants reference known permissions; arrays cannot be mutated', () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS), ACCESS_ROLES);
  for (const permissions of Object.values(ROLE_PERMISSIONS)) {
    assert.equal(Object.isFrozen(permissions), true);
    assert.ok(permissions.every(p => PERMISSIONS.includes(p)));
  }
});
test('registration identity has self-service but no privileged operations', () => {
  for (const permission of ['self.profile','self.attendance','self.leave','self.payslips','announcements.read']) assert.equal(hasPermission(person(),permission),true);
  for (const permission of ['employees.manage','payroll.prepare','payroll.approve','settlements.manage','access.manage']) assert.equal(hasPermission(person(),permission),false);
});
test('HR prepares payroll and employee facts but cannot approve, pay or settle', () => {
  const user=person('hr');
  for (const p of ['employees.manage','organization.manage','salary_profiles.manage','attendance.manage','leave.manage','announcements.manage','payroll.prepare','audit.hr']) assert.equal(hasPermission(user,p),true,p);
  for (const p of ['payroll.approve','payroll.pay','payroll_settings.manage','deductions.manage','company_costs.read','settlements.manage','access.manage','audit.access']) assert.equal(hasPermission(user,p),false,p);
});
test('Finance reviews and pays but cannot modify HR records or issue access', () => {
  const user=person('finance');
  for (const p of ['employees.read','attendance.read','leave.read','payroll.read','payroll.approve','payroll.pay','payroll_settings.manage','deductions.manage','company_costs.read','settlements.manage','audit.finance']) assert.equal(hasPermission(user,p),true,p);
  for (const p of ['employees.manage','organization.manage','salary_profiles.manage','attendance.manage','leave.manage','announcements.manage','payroll.prepare','access.manage','audit.access']) assert.equal(hasPermission(user,p),false,p);
});
test('additive grants retain employee portal access, combine and revoke without mutating identity', () => {
  const user=person('hr','finance');
  assert.equal(hasPermission(user,'payroll.prepare'),true);assert.equal(hasPermission(user,'payroll.pay'),true);assert.equal(hasPermission(user,'self.payslips'),true);
  const original=JSON.stringify(user);const list=permissionsFor(user);list.push('made.up');assert.equal(JSON.stringify(user),original);assert.equal(hasPermission(user,'made.up'),false);
  user.accessRoles=['finance'];assert.equal(hasPermission(user,'payroll.prepare'),false);assert.equal(hasPermission(user,'self.profile'),true);
  user.accessRoles=[];assert.equal(hasPermission(user,'payroll.pay'),false);assert.equal(user.role,'employee');
});
test('Admin controls business permissions; legacy non-employee admin does not acquire an employee identity', () => {
  const admin=person('admin');for(const p of PERMISSIONS)assert.equal(hasPermission(admin,p),true,p);
  const root={role:'hr',accessRoles:['admin']};assert.equal(hasPermission(root,'access.manage'),true);assert.equal(hasPermission(root,'self.payslips'),false);
  assert.equal(hasPermission({role:'hr'},'access.manage'),false); // migration must explicitly grant legacy admin access
});
test('unknown roles, malformed grants and permission wildcards fail closed', () => {
  assert.deepEqual(permissionsFor(null),[]);assert.deepEqual(permissionsFor({role:'other',accessRoles:['admin']}),[]);
  for(const grants of ['admin',{},[null,'unknown','*',{'role':'admin'}]])assert.equal(hasPermission({role:'employee',accessRoles:grants},'access.manage'),false);
  assert.equal(hasPermission(person('admin'),'*'),false);assert.equal(hasPermission(person('admin'),'not.real'),false);
});
test('permission guard enforces authentication, permission and lock in order', () => {
  const guard=requirePermission('payroll.approve');assert.equal(guard[GUARD],true);
  assert.equal(run(guard,null).status,401);assert.equal(run(guard,person('hr')).status,403);
  assert.equal(run(guard,person('finance'),{session:{locked:true}}).status,423);
  assert.equal(run(guard,person('finance')),null);assert.equal(run(guard,person('admin')),null);
  assert.equal(run(guard,person(),{body:{accessRoles:['admin']},query:{accessRoles:['admin']},headers:{'x-role':'admin'}}).status,403);
  assert.throws(()=>requirePermission('misspelled.permission'),/Unknown permission/);
});
test('only an explicit allowLocked option permits an authorized locked session', () => {
  const guard=requirePermission('attendance.qr',{allowLocked:true});
  assert.equal(run(guard,person('hr'),{session:{locked:true}}),null);
  assert.equal(run(guard,person('finance'),{session:{locked:true}}).status,403);
});
test('legacy role guards keep current production behavior during foundation rollout', () => {
  assert.equal(run(requireHr,{role:'hr'}),null);assert.equal(run(requireHr,person('hr')).status,403);
  assert.equal(run(requireEmployee,person('hr','finance')),null);
});
