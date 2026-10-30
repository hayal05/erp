// Pure helpers for the employee form (kept free of React so they are unit-tested).
// The server is the authority (task 1.15); these checks only save a round trip and shape the payload.
import { salarySummary, sameSalary } from './positionForm.js';

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
];

export const MIN_PASSWORD = 10;
const MAX_PASSWORD_BYTES = 72; // bcrypt limit, same rule as the server
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emptyForm = () => ({
  employeeCode: '', fullName: '', username:'',email: '', phone: '', departmentId: '', positionId: '', jobTitle: '',
  startDate: '', employmentType: 'full_time', shiftId: '', password: '', applyPositionSalary: true,
});

export const formFromEmployee = (e) => ({
  employeeCode: e.employeeCode, fullName: e.fullName, username:e.username??'',email: e.email??'', phone: e.phone ?? '',
  departmentId: e.departmentId == null ? '' : String(e.departmentId), positionId: e.positionId == null ? '' : String(e.positionId),
  jobTitle: e.jobTitle ?? '', // shown read-only: the position owns the title once one is chosen (task 6.10)
  startDate: e.startDate, employmentType: e.employmentType, shiftId: String(e.shiftId), password: '',
  applyPositionSalary: true, // checked by default; only sent when the position actually changes
});

// Strings are trimmed (the password is not); the apply checkbox stays a boolean.
const clean = (form) => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k === 'password' || typeof v === 'boolean' ? v : String(v ?? '').trim()]));

// Choosing another department empties the position (a position belongs to one department). Going back to the department the
// employee started in restores their original position, so an accidental switch costs nothing.
export function changeDepartment(form, departmentId, original) {
  const restore = original && String(original.departmentId ?? '') === String(departmentId) && departmentId !== '' && original.positionId != null;
  return { ...form, departmentId, positionId: restore ? String(original.positionId) : '', applyPositionSalary: true };
}

// Returns { field: message } (empty object = fine). `mode` is 'create' or 'edit'.
export function validateForm(form, mode, original) {
  const f = clean(form);
  const errors = {};
  if (!f.employeeCode) errors.employeeCode = 'Enter the employee ID';
  else if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(f.employeeCode)) errors.employeeCode = 'Use letters, numbers and . _ - / only (no spaces)';
  if (!f.fullName) errors.fullName = 'Enter the full name';
  if (!f.username) errors.username='Enter the username';
  else if(!(mode==='edit'&&f.username===original?.username)&&!/^[A-Za-z0-9][A-Za-z0-9._@+\-]{2,253}$/.test(f.username)) errors.username='Use 3–254 letters, numbers and . _ - @ + only';
  if (f.email && !EMAIL.test(f.email)) errors.email = 'Enter a valid email address';
  if (!f.startDate) errors.startDate = 'Choose the start date';
  if (f.phone && !/^[0-9+()\-.\s]+$/.test(f.phone)) errors.phone = 'Digits and + ( ) - . only';
  if (mode === 'create') {
    if (typeof form.password !== 'string' || form.password.length < MIN_PASSWORD) errors.password = `At least ${MIN_PASSWORD} characters`;
    else if (new TextEncoder().encode(form.password).length > MAX_PASSWORD_BYTES) errors.password = `At most ${MAX_PASSWORD_BYTES} bytes`;
  }
  return errors;
}

const toId = (s) => (s === '' ? null : Number(s));

// POST body. Blank optional fields are left out; the server picks the first shift when shiftId is missing.
export function buildCreate(form) {
  const f = clean(form);
  const body = { employeeCode: f.employeeCode, fullName: f.fullName, username:f.username.toLowerCase(), startDate: f.startDate,
    employmentType: f.employmentType, password: form.password };
  if (f.email) body.email=f.email;
  if (f.phone) body.phone = f.phone;
  if (f.departmentId) body.departmentId = Number(f.departmentId);
  // The position's salary is copied by the server; no salary figures are ever sent, and the title comes from the position.
  if (f.positionId && f.departmentId) body.positionId = Number(f.positionId);
  if (f.shiftId) body.shiftId = Number(f.shiftId);
  return body;
}

// PATCH body: only what changed. A blank optional field becomes null (the server's way of clearing it).
export function buildPatch(form, original) {
  const now = clean(form);
  const was = clean(formFromEmployee(original));
  const body = {};
  for (const key of ['employeeCode', 'fullName', 'startDate', 'employmentType']) if (now[key] !== was[key]) body[key] = now[key];
  if(now.username.toLowerCase()!==was.username.toLowerCase())body.username=now.username.toLowerCase();
  if(now.email!==was.email)body.email=now.email||null;
  if (now.phone !== was.phone) body.phone = now.phone || null;
  if (now.departmentId !== was.departmentId) body.departmentId = toId(now.departmentId);
  // Position: sent only when it changed. Choosing one also says whether its salary replaces the current one (the checkbox);
  // clearing one sends null and the server keeps the salary and the last title.
  if (now.positionId !== was.positionId) {
    body.positionId = toId(now.positionId);
    if (body.positionId !== null) body.applyPositionSalary = form.applyPositionSalary === true;
  }
  if (now.shiftId !== was.shiftId && now.shiftId !== '') body.shiftId = Number(now.shiftId);
  return body;
}

// What the salary part of the form should show (task 6.10). `positions` = the chosen department's positions, `profile` = the
// employee's current salary (or null while it is unknown). Returns one of:
//   { kind: 'none' }                        nothing chosen / nothing to say
//   { kind: 'preview', next }               new employee: the salary the position will give them (read-only)
//   { kind: 'change', current, next, same, apply }   position changed on an existing employee: current versus new + the checkbox
//   { kind: 'cleared' }                     position removed: the salary stays
export function salaryPlan({ form, original, positions, profile }) {
  const chosen = positions.find((p) => String(p.id) === form.positionId);
  const was = original?.positionId == null ? '' : String(original.positionId);
  if (!form.positionId) return original && was ? { kind: 'cleared' } : { kind: 'none' };
  if (!chosen) return { kind: 'none' }; // positions still loading, or not in the list
  const next = salarySummary(chosen);
  if (!original) return { kind: 'preview', next };
  if (form.positionId === was) return { kind: 'none' };
  return {
    kind: 'change', next, current: profile ? salarySummary(profile) : null,
    same: profile ? sameSalary(profile, chosen) : false, apply: form.applyPositionSalary === true,
  };
}

// True when the form changes the position of an existing employee to a real position: the current salary is then worth loading.
export const needsCurrentSalary = (form, original) => Boolean(original) && form.positionId !== '' && form.positionId !== (original.positionId == null ? '' : String(original.positionId));

export const positionOptions = (positions) => positions.map((p) => ({ value: p.id, label: p.name }));

// The toast after a successful save, naming what happened to the salary when a position was involved.
export function savedMessage(mode, body, saved) {
  if (mode === 'create') return body.positionId ? `${saved.fullName} was added with the salary of the ${saved.positionName ?? 'chosen'} position` : `${saved.fullName} was added`;
  if (body.applyPositionSalary === true) return 'Changes saved. The salary now follows the new position';
  if (body.applyPositionSalary === false) return 'Changes saved. The current salary was kept';
  return 'Changes saved';
}

// A failed save -> { fields, message } (task 6.11: moved out of the dialog so it can be tested). 400, 409 and 422 carry field
// messages for the inputs (a duplicate username, a position of another department, ...); `message` goes at the top of the dialog.
const FIELD_STATUSES = [400, 409, 422];
export function employeeSaveError(err) {
  const all = err?.fields ?? {};
  const fields = FIELD_STATUSES.includes(err?.status) ? all : {};
  const message = all._ ?? all.applyPositionSalary
    ?? (Object.keys(all).length ? 'Please fix the highlighted fields.' : (err?.message || 'Something went wrong. Nothing was saved.'));
  return { fields, message };
}
