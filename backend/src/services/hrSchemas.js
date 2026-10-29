import { v } from '../middleware/validate.js';
import { pageSchema } from './sql.js';

// Request schemas for the HR-managed records (kept free of Express/pg so they are unit-testable).
// PATCH schemas have no defaults: an omitted field means "unchanged"; send null to clear an optional one.

export const idParams = { id: v.int({ required: true, min: 1 }) };
export const reasonBody = { reason: v.string({ max: 500 }) };

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];
export const JOB_TITLE_MAX = 100; // positions (services/positions.js) use the same limit: the position name becomes the job title

const employeeFields = (create) => ({
  employeeCode: v.string({ required: create, max: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
    patternMessage: 'Use letters, numbers and . _ - / only (no spaces)' }),
  fullName: v.string({ required: create, max: 120 }),
  email: v.email({ required: create }),
  phone: v.string({ nullable: true, max: 30, pattern: /^[0-9+()\-.\s]+$/, patternMessage: 'Digits and + ( ) - . only' }),
  departmentId: v.int({ nullable: true, min: 1 }),
  jobTitle: v.string({ nullable: true, max: JOB_TITLE_MAX }), // ignored while the employee holds a position: the position name is the title
  positionId: v.int({ nullable: true, min: 1 }), // must belong to departmentId (task 6.5); null clears it
  startDate: v.date({ required: create }),
  employmentType: v.enum({ values: EMPLOYMENT_TYPES, ...(create ? { default: 'full_time' } : {}) }),
  shiftId: v.int({ min: 1 }), // omitted on create = the first shift
});

// The password is never trimmed; strength is checked in the route with services/password.js.
export const employeeCreate = { ...employeeFields(true), password: v.string({ required: true, trim: false, max: 256 }) };
// applyPositionSalary: only meaningful together with a positionId; true copies that position's salary package onto the
// employee, false or omitted keeps the current salary. Never accepted on create (a position always applies there).
export const employeeUpdate = { ...employeeFields(false), applyPositionSalary: v.boolean() };
export const employeeListQuery = {
  ...pageSchema,
  search: v.string({ max: 100 }),
  status: v.enum({ values: ['active', 'inactive'] }),
  departmentId: v.int({ min: 1 }),
  shiftId: v.int({ min: 1 }),
};

export const departmentBody = { name: v.string({ required: true, max: 100 }) };
export const departmentListQuery = { ...pageSchema, search: v.string({ max: 100 }) };
export const positionListQuery = { ...pageSchema, search: v.string({ max: 100 }) };

const shiftFields = (create) => ({
  name: v.string({ required: create, max: 100 }),
  startTime: v.time({ required: create }),
  endTime: v.time({ required: create }), // must be after startTime (same-day shifts only): enforced by the DB CHECK
  graceMinutes: v.int({ min: 0, max: 240, ...(create ? { default: 0 } : {}) }),
  workDays: v.intList({ min: 1, max: 7, minItems: 1, maxItems: 7, ...(create ? { default: [1, 2, 3, 4, 5] } : {}) }),
});
export const shiftCreate = shiftFields(true);
export const shiftUpdate = shiftFields(false);
export const shiftListQuery = pageSchema;

// ---- HR attendance records (task 2.17)
export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'on_leave', 'incomplete'];
export const attendanceListQuery = {
  view: v.enum({ values: ['today', 'archive'] }),
  ...pageSchema,
  from: v.date(), // first work date, inclusive
  to: v.date(), // last work date, inclusive
  employeeId: v.int({ min: 1 }),
  departmentId: v.int({ min: 1 }),
  status: v.enum({ values: ATTENDANCE_STATUSES }),
};
// Employee's own history (task 2.19): dates only, the employee is always the signed-in user.
export const myAttendanceQuery = { ...pageSchema, from: v.date(), to: v.date() };
export const photoParams = { id: v.int({ required: true, min: 1 }), kind: v.enum({ values: ['check_in', 'check_out'], required: true }) };

// PATCH: omitted = unchanged; null clears a time. Times are HH:MM wall-clock in the COMPANY timezone on the record's work date.
export const attendanceCorrection = {
  reason: v.string({ required: true, min: 3, max: 500 }),
  status: v.enum({ values: ATTENDANCE_STATUSES }),
  checkInTime: v.time({ nullable: true }),
  checkOutTime: v.time({ nullable: true }),
  lateMinutes: v.int({ min: 0, max: 1440 }),
};

// ---- Leave (spec 10, tasks 3.3-3.4)
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const leaveYear = v.int({ min: 2000, max: 2100 });
// Employee's own request. Days are never sent: the server counts them (shift work days minus holidays).
export const leaveRequestBody = {
  leaveTypeId: v.int({ required: true, min: 1 }),
  startDate: v.date({ required: true }),
  endDate: v.date({ required: true }),
  reason: v.string({ required: true, min: 3, max: 500 }),
};
export const leaveBalanceQuery = { year: leaveYear };
export const myLeaveQuery = { ...pageSchema, status: v.enum({ values: LEAVE_STATUSES }), year: leaveYear };

// HR side (task 3.4). Approve may carry optional remarks; a rejection needs them (DB check + the employee must learn why).
export const leaveHrListQuery = { ...myLeaveQuery, employeeId: v.int({ min: 1 }), departmentId: v.int({ min: 1 }) };
export const leaveApproveBody = { remarks: v.string({ nullable: true, max: 500 }) };
export const leaveRejectBody = { remarks: v.string({ required: true, min: 3, max: 500 }) };
export const leaveHrBalanceQuery = { employeeId: v.int({ required: true, min: 1 }), year: leaveYear };
// Entitlement is SET (absolute); adjustDays is a signed CHANGE to HR's adjustment. At least one is needed; the reason always is.
export const leaveBalanceChange = {
  employeeId: v.int({ required: true, min: 1 }),
  leaveTypeId: v.int({ required: true, min: 1 }),
  year: v.int({ required: true, min: 2000, max: 2100 }),
  entitledDays: v.int({ min: 0, max: 366 }),
  adjustDays: v.int({ min: -366, max: 366 }),
  reason: v.string({ required: true, min: 3, max: 500 }),
};

// ---- Company settings (task 3.7): holidays. `date` is a real calendar date; one holiday per date.
export const holidayCreate = { date: v.date({ required: true }), name: v.string({ required: true, max: 100 }) };
export const holidayUpdate = { date: v.date(), name: v.string({ max: 100 }) };
export const holidayListQuery = { year: leaveYear };
