import { v } from '../middleware/validate.js';
import { employeeListQuery } from './hrSchemas.js';
import { pageSchema } from './sql.js';
import { retirementListQuery } from './retirement.js';
import { attendancePdf } from './attendancePdf.js';
import { attendanceWorkbook } from './attendanceWorkbook.js';
import { attendanceWord } from './attendanceWord.js';
import {
  readDepartmentHeadcount, readEmployeeDirectory, readPositionHistoryReport,
  readProfileReport, readRetirementReport,
} from './employeeReportData.js';

const base = { group: 'Employees', permission: 'employees.read', lookupPath: '/reports/employee-lookups' };
const department = { key: 'departmentId', label: 'Department', type: 'select', placeholder: 'All departments', lookup: 'departments' };
const employee = { key: 'employeeId', label: 'Employee', type: 'select', placeholder: 'Choose an employee', lookup: 'employees', required: true };
const search = { key: 'search', label: 'Search employees', placeholder: 'Name or employee ID', type: 'search' };
const employmentStatus = {
  key: 'status', label: 'Employment status', type: 'select', placeholder: 'All statuses',
  options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
};
const listSchema = { ...pageSchema, departmentId: employeeListQuery.departmentId, status: employeeListQuery.status };
const individualSchema = { ...pageSchema, employeeId: v.int({ required: true, min: 1 }) };
const identity = [
  { key: 'employeeCode', header: 'Employee ID', width: 18 },
  { key: 'fullName', header: 'Employee', width: 30 },
];
const departmentColumn = { key: 'departmentName', header: 'Department', width: 23 };
const detailExports = { xlsx: attendanceWorkbook, pdf: attendancePdf };
const retirementStatuses = [
  ['reached', 'Retirement age reached'],
  ['within_year', 'Within one year'],
  ['later', 'More than one year'],
  ['missing_birth_date', 'Missing birth date'],
  ['not_configured', 'Age not set'],
];

export const employeeReports = [
  ['employee-directory', {
    ...base, title: 'Employee directory', exports: detailExports,
    filters: [search, department, employmentStatus],
    schema: { ...listSchema, search: employeeListQuery.search },
    columns: [...identity, departmentColumn,
      { key: 'position', header: 'Position', width: 25 },
      { key: 'employmentType', header: 'Employment type', width: 18 },
      { key: 'startDate', header: 'Start date', type: 'date' },
      { key: 'status', header: 'Status' },
    ],
    preview: async (user, filters) => {
      const result = await readEmployeeDirectory(user, filters);
      return { ...result, items: result.items.map(row => ({ ...row, position: row.positionName ?? row.jobTitle })) };
    },
  }],
  ['department-headcount', {
    ...base, title: 'Department headcount', exports: { ...detailExports, docx: attendanceWord },
    filters: [department, employmentStatus], schema: listSchema,
    columns: [departmentColumn,
      { key: 'active', header: 'Active' }, { key: 'inactive', header: 'Inactive' }, { key: 'total', header: 'Total' },
    ],
    preview: readDepartmentHeadcount,
  }],
  ['employee-profile', {
    ...base, title: 'Employee profile', exports: { pdf: attendancePdf, docx: attendanceWord },
    filters: [employee], schema: individualSchema,
    columns: [{ key: 'label', header: 'Field', width: 22 }, { key: 'value', header: 'Details', width: 75 }],
    preview: readProfileReport,
  }],
  ['employee-position-history', {
    ...base, title: 'Employee position history', exports: detailExports,
    filters: [employee], schema: individualSchema,
    columns: [...identity,
      { key: 'recordedOn', header: 'Recorded on', type: 'date' },
      { key: 'department', header: 'Department', width: 25 },
      { key: 'position', header: 'Position', width: 25 },
      { key: 'entryType', header: 'Entry', width: 18 },
    ],
    preview: readPositionHistoryReport,
  }],
  ['retirement-forecast', {
    ...base, title: 'Retirement forecast', exports: detailExports,
    description: 'Uses the configured retirement age and the company date.',
    filters: [search, department,
      { ...employmentStatus, key: 'employmentStatus', default: 'active',
        options: [...employmentStatus.options, { value: 'all', label: 'All statuses' }], placeholder: undefined },
      { key: 'status', label: 'Retirement status', type: 'select', placeholder: 'All retirement statuses',
        options: retirementStatuses.map(([value, label]) => ({ value, label })) },
    ],
    schema: { ...retirementListQuery, departmentId: employeeListQuery.departmentId },
    columns: [...identity,
      { key: 'department', header: 'Department', width: 23 },
      { key: 'position', header: 'Position', width: 22 },
      { key: 'age', header: 'Age', width: 8 },
      { key: 'retirementDate', header: 'Retirement date', type: 'date', width: 17 },
      { key: 'daysRemaining', header: 'Days remaining', width: 16 },
      { key: 'retirementStatus', header: 'Status', width: 25 },
    ],
    preview: async (user, filters) => {
      const result = await readRetirementReport(user, filters);
      return { ...result, items: result.items.map(row => ({
        ...row, retirementStatus: retirementStatuses.find(([value]) => value === row.status)?.[1] ?? row.status,
      })) };
    },
  }],
];
