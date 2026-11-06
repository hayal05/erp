import { query, withTransaction } from '../db/pool.js';
import { activityScopePlan, expandActivities } from '../../../shared/accessActivities.mjs';
import { ROLE_PERMISSIONS, permissionsFor } from './permissions.js';
import { permissionScope } from './accessScope.js';
import { likePattern, pageOffset, pageResult } from './sql.js';

function reportPage(rows, filters) {
  const offset = pageOffset(filters);
  const items = [];
  let total = 0;
  for (const row of rows) {
    if (total >= offset && items.length < filters.pageSize) items.push({ ...row, id: total + 1 });
    total += 1;
  }
  return pageResult(items, filters, total);
}

export async function readCustomRolePermissions(_user, filters) {
  const { rows } = await query(`SELECT name, activities, permissions, version FROM custom_access_roles
    WHERE name ILIKE $1 ORDER BY lower(name), id`, [likePattern(filters.search ?? '')]);
  return reportPage(rows.flatMap(role => {
    const activities = role.activities ?? role.permissions;
    return expandActivities(activities).map(permission => ({
      roleName: role.name, version: role.version, permission,
      source: activities.includes(permission) ? 'Selected activity' : 'Required by activity',
    }));
  }), filters);
}

async function loadGrants(db, filters) {
  const { rows } = await db.query(`
    WITH grants AS (
      SELECT g.id, g.user_id, 'Built-in' AS kind, g.access_role AS role_name, 'all' AS scope_type,
        '{}'::bigint[] AS department_ids, '{}'::bigint[] AS employee_ids,
        NULL::text[] AS activities, g.granted_at, g.granted_by_user_id AS grantor_id
      FROM access_grants g WHERE g.revoked_at IS NULL
      UNION ALL
      SELECT g.id, g.user_id, 'Custom', r.name, g.scope_type, g.department_ids, g.employee_ids,
        COALESCE(r.activities, r.permissions), g.granted_at, g.granted_by
      FROM custom_access_grants g JOIN custom_access_roles r ON r.id=g.role_id WHERE g.revoked_at IS NULL
    )
    SELECT g.*, u.full_name AS "fullName", u.username, u.role, u.is_active AND
      COALESCE(e.status='active', u.role='hr') AS active, e.employee_code AS "employeeCode",
      grantor.username AS "grantedBy", to_char(g.granted_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS "grantedOn"
    FROM grants g JOIN users u ON u.id=g.user_id
    LEFT JOIN employees e ON e.user_id=u.id LEFT JOIN users grantor ON grantor.id=g.grantor_id
    WHERE ($2::bigint IS NULL OR e.id=$2) AND
      (u.full_name ILIKE $1 OR u.username ILIKE $1 OR e.employee_code ILIKE $1)
    ORDER BY lower(u.full_name), u.id, g.kind, lower(g.role_name), g.id
  `, [likePattern(filters.search ?? ''), filters.employeeId ?? null]);
  return rows;
}

const scopeNames = { all: 'All employees', departments: 'Departments', employees: 'Selected employees' };
const identity = grant => ({
  fullName: grant.fullName, username: grant.username, employeeCode: grant.employeeCode,
});
const grantFields = grant => ({
  ...identity(grant), grantRef: `${grant.kind} #${grant.id}`, roleName: grant.role_name,
  scope: scopeNames[grant.scope_type], accountStatus: grant.active ? 'Active' : 'Inactive',
});

function* scopeTargets(scope, names) {
  if (scope === null) {
    yield { scope: scopeNames.all, target: '' };
    return;
  }
  for (const [key, ids] of [['departments', scope.departmentIds], ['employees', scope.employeeIds]]) {
    for (const id of [...ids].sort((a, b) => a - b)) {
      yield { scope: scopeNames[key], target: names[key].get(Number(id)) ?? `ID ${id} (unavailable)` };
    }
  }
}

function* assignmentRows(grants, names) {
  for (const grant of grants) {
    const scope = grant.scope_type === 'all' ? null : { departmentIds: grant.department_ids, employeeIds: grant.employee_ids };
    for (const target of scopeTargets(scope, names)) {
      yield { ...grantFields(grant), ...target, grantedBy: grant.grantedBy ?? 'System bootstrap', grantedOn: grant.grantedOn };
    }
  }
}

function* allowanceRows(grants) {
  for (const grant of grants) {
    const defined = grant.activities ? expandActivities(grant.activities) : ROLE_PERMISSIONS[grant.role_name];
    const allowed = grant.activities ? new Set(activityScopePlan(grant.activities, grant.scope_type).permissions) : new Set(defined);
    for (const permission of defined) {
      yield { ...grantFields(grant), permission, allowance: allowed.has(permission) ? 'Allowed by grant' : 'Excluded by scope' };
    }
  }
}

function* effectiveRows(grants, names) {
  const accounts = new Map();
  for (const grant of grants) {
    if (!grant.active) continue;
    if (!accounts.has(grant.user_id)) accounts.set(grant.user_id, {
      ...identity(grant), role: grant.role, accessRoles: [], customGrants: [],
    });
    const account = accounts.get(grant.user_id);
    if (grant.kind === 'Built-in') account.accessRoles.push(grant.role_name);
    else account.customGrants.push({
      scopeType: grant.scope_type, departmentIds: grant.department_ids.map(Number), employeeIds: grant.employee_ids.map(Number),
      permissions: activityScopePlan(grant.activities, grant.scope_type).permissions,
    });
  }
  for (const account of accounts.values()) {
    const sources = [...account.accessRoles.map(role => ROLE_PERMISSIONS[role]), ...account.customGrants.map(grant => grant.permissions)];
    const granted = new Set(sources.flat());
    for (const permission of permissionsFor(account)) {
      if (!granted.has(permission)) continue;
      const grantCount = sources.filter(permissions => permissions.includes(permission)).length;
      for (const target of scopeTargets(permissionScope(account, permission), names)) {
        yield { ...identity(account), permission, ...target, grantCount };
      }
    }
  }
}

const reportRows = { assignments: assignmentRows, allowances: allowanceRows, effective: effectiveRows };

export function readAccessGrants(kind, filters) {
  return withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const grants = await loadGrants(db, filters);
    const names = {};
    if (kind !== 'allowances') {
      const departmentIds = [...new Set(grants.flatMap(grant => grant.department_ids))];
      const employeeIds = [...new Set(grants.flatMap(grant => grant.employee_ids))];
      const { rows: departments } = await db.query('SELECT id, name FROM departments WHERE id=ANY($1::bigint[])', [departmentIds]);
      const { rows: employees } = await db.query(`SELECT e.id, u.full_name || ' (' || e.employee_code || ')' AS name
        FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=ANY($1::bigint[])`, [employeeIds]);
      names.departments = new Map(departments.map(row => [Number(row.id), row.name]));
      names.employees = new Map(employees.map(row => [Number(row.id), row.name]));
    }
    return reportPage(reportRows[kind](grants, names), filters);
  });
}
