import {test} from 'node:test';
import assert from 'node:assert/strict';
import {permissionsFor} from '../src/services/permissions.js';
import {permissionScope,scopeSql} from '../src/services/accessScope.js';
import {expandActivities,SCOPED_ACTIVITIES} from '../../shared/accessActivities.mjs';
test('scope unions are per activity, and a broader read grant does not broaden correction rights',()=>{
 const u={role:'employee',accessRoles:[],customGrants:[{scopeType:'all',permissions:['attendance.read']},{scopeType:'departments',departmentIds:[2],employeeIds:[],permissions:['attendance.manage']},{scopeType:'employees',departmentIds:[],employeeIds:[9],permissions:['attendance.manage']}]};
 assert.equal(permissionScope(u,'attendance.read'),null);assert.deepEqual(permissionScope(u,'attendance.manage'),{departmentIds:[2],employeeIds:[9]});
 const params=['initial'];assert.equal(scopeSql(u,'attendance.manage','e',params),'(e.department_id=ANY($2::bigint[]) OR e.id=ANY($3::bigint[]))');assert.deepEqual(params,['initial',[2],[9]]);
 assert.equal(permissionScope({...u,accessRoles:['hr']},'attendance.manage'),null);
});
test('required activities expand transitively while protected Admin rights cannot come from custom grants',()=>{
 assert.ok(expandActivities(['employees.manage']).every(p=>SCOPED_ACTIVITIES.includes(p)));
 const permissions=expandActivities(['attendance.manage']);for(const p of ['attendance.read','audit.hr','approvals.read'])assert.ok(permissions.includes(p));assert.ok(permissions.every(p=>SCOPED_ACTIVITIES.includes(p)));
 const u={role:'employee',customGrants:[{permissions:['access.manage','audit.access','attendance.read','*']}]};assert.ok(permissionsFor(u).includes('attendance.read'));assert.ok(!permissionsFor(u).includes('access.manage'));assert.ok(!permissionsFor(u).includes('audit.access'));assert.ok(!permissionsFor(u).includes('*'));
});
