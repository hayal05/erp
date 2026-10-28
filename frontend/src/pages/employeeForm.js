// Pure helpers for the employee form (kept free of React so they are unit-tested).
// The server is the authority (task 1.15); these checks only save a round trip and shape the payload.

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
  employeeCode: '', fullName: '', email: '', phone: '', departmentId: '', jobTitle: '',
  startDate: '', employmentType: 'full_time', shiftId: '', password: '',
});

export const formFromEmployee = (e) => ({
  employeeCode: e.employeeCode, fullName: e.fullName, email: e.email, phone: e.phone ?? '',
  departmentId: e.departmentId == null ? '' : String(e.departmentId), jobTitle: e.jobTitle ?? '',
  startDate: e.startDate, employmentType: e.employmentType, shiftId: String(e.shiftId), password: '',
});

const clean = (form) => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k === 'password' ? v : String(v ?? '').trim()]));

// Returns { field: message } (empty object = fine). `mode` is 'create' or 'edit'.
export function validateForm(form, mode) {
  const f = clean(form);
  const errors = {};
  if (!f.employeeCode) errors.employeeCode = 'Enter the employee ID';
  else if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(f.employeeCode)) errors.employeeCode = 'Use letters, numbers and . _ - / only (no spaces)';
  if (!f.fullName) errors.fullName = 'Enter the full name';
  if (!f.email) errors.email = 'Enter the email';
  else if (!EMAIL.test(f.email)) errors.email = 'Enter a valid email address';
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
  const body = { employeeCode: f.employeeCode, fullName: f.fullName, email: f.email, startDate: f.startDate,
    employmentType: f.employmentType, password: form.password };
  if (f.phone) body.phone = f.phone;
  if (f.jobTitle) body.jobTitle = f.jobTitle;
  if (f.departmentId) body.departmentId = Number(f.departmentId);
  if (f.shiftId) body.shiftId = Number(f.shiftId);
  return body;
}

// PATCH body: only what changed. A blank optional field becomes null (the server's way of clearing it).
export function buildPatch(form, original) {
  const now = clean(form);
  const was = clean(formFromEmployee(original));
  const body = {};
  for (const key of ['employeeCode', 'fullName', 'email', 'startDate', 'employmentType']) if (now[key] !== was[key]) body[key] = now[key];
  for (const key of ['phone', 'jobTitle']) if (now[key] !== was[key]) body[key] = now[key] || null;
  if (now.departmentId !== was.departmentId) body.departmentId = toId(now.departmentId);
  if (now.shiftId !== was.shiftId && now.shiftId !== '') body.shiftId = Number(now.shiftId);
  return body;
}
