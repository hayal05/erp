import { v } from '../middleware/validate.js';
import { pageSchema } from './sql.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';
import { attendanceWord } from './attendanceWord.js';
import { readAccessGrants, readCustomRolePermissions } from './accessReportData.js';

const base = { group: 'Access administration', permission: 'access.manage', exports: { xlsx: attendanceWorkbook, pdf: attendancePdf } };
const search = { key: 'search', label: 'Search', type: 'search', placeholder: 'Name, username or employee ID' };
const schema = { ...pageSchema, search: v.string({ max: 120 }) };
const grantReport = {
  ...base, lookupPath: '/reports/access-lookups', schema: { ...schema, employeeId: v.int({ min: 1 }) },
  filters: [search, { key: 'employeeId', label: 'Employee', type: 'select', placeholder: 'All employees', lookup: 'employees' }],
};
const column = (key, header, width) => ({ key, header, width });
const account = [column('fullName', 'Name', 23), column('username', 'Username', 20), column('employeeCode', 'Employee ID', 14)];
const grant = [...account, column('grantRef', 'Grant', 13), column('roleName', 'Role', 22), column('accountStatus', 'Account', 11)];
const scope = column('scope', 'Scope', 16);
const target = column('target', 'Scope target', 26);
const permission = column('permission', 'Permission', 25);

export const accessReports = [
  ['access-active-grants', {
    ...grantReport, title: 'Active access grants',
    description: 'Unrevoked grants and their assigned scope, including grants on inactive accounts.',
    columns: [...grant, scope, target, column('grantedBy', 'Granted by', 20), column('grantedOn', 'Granted on (UTC)', 17)],
    preview: (_user, filters) => readAccessGrants('assignments', filters),
  }],
  ['access-role-permissions', {
    ...base, title: 'Custom role permissions',
    filters: [{ ...search, placeholder: 'Custom role name' }], schema,
    columns: [column('roleName', 'Custom role', 26), column('version', 'Version', 10), permission, column('source', 'Permission source', 21)],
    preview: readCustomRolePermissions,
  }],
  ['access-grant-permissions', {
    ...grantReport, title: 'Access grant permissions',
    description: 'Shows which role permissions each grant allows and which its assigned scope excludes.',
    columns: [...grant, scope, permission, column('allowance', 'Grant allowance', 20)],
    preview: (_user, filters) => readAccessGrants('allowances', filters),
  }],
  ['access-effective', {
    ...grantReport, title: 'Effective access review', exports: { ...base.exports, docx: attendanceWord },
    description: 'Combines unrevoked grants for active accounts. All employees access overrides narrower grants for the same permission.',
    columns: [...account, permission, scope, target, column('grantCount', 'Allowing grants', 13)],
    preview: (_user, filters) => readAccessGrants('effective', filters),
  }],
];
