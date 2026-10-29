// Pure helpers for the HR Departments page (task 6.8). Counts come from the server (`employeeCount`, `positionCount`);
// nothing here talks to the network or the browser, so it is all unit-tested.

export const NAME_MAX = 100; // same limit as the server (departmentBody)

export const EMPTY_DEPARTMENT = { name: '' };
export const departmentForm = (d) => ({ name: d.name });

export function validateDepartment(f) {
  const e = {};
  const name = String(f.name ?? '').trim();
  if (!name) e.name = 'Give the department a name';
  else if (name.length > NAME_MAX) e.name = `At most ${NAME_MAX} characters`;
  return e;
}
export const buildDepartment = (f) => ({ name: String(f.name ?? '').trim() });
// Case-only changes count as a change: the server stores the name as typed.
export const departmentChanged = (f, d) => buildDepartment(f).name !== d.name;

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const departmentRow = (d) => ({ id: d.id, name: d.name, employees: d.employeeCount ?? 0, positions: d.positionCount ?? 0 });

// What the delete dialog should say. `blocked` is true when the counts already show the server will refuse; the server stays the
// authority (counts can be stale), and its own message is shown if it refuses anyway. Positions are named first, like the server does.
export function deleteView(d) {
  const positions = d.positionCount ?? 0;
  const employees = d.employeeCount ?? 0;
  if (positions > 0) {
    return { blocked: true, message: `${d.name} still has ${plural(positions, 'position')}. Delete its positions first, then delete the department.` };
  }
  if (employees > 0) {
    return { blocked: true, message: `${d.name} still has ${plural(employees, 'employee')}, including inactive ones. Move them to another department first.` };
  }
  return { blocked: false, message: `${d.name} has no positions and no employees. Deleting it cannot be undone.` };
}

// A failed save or delete -> { fields, message }. Field messages sit under the inputs; `message` goes at the top of the dialog.
export function saveErrorView(err) {
  const fields = err?.fields ?? {};
  if (Object.keys(fields).length) return { fields, message: '' };
  if (err?.status === 0 || err?.code === 'network') return { fields: {}, message: 'Cannot reach the server. Nothing was changed. Check your connection and try again.' };
  if (err?.status === 404) return { fields: {}, message: 'This department no longer exists. Close this window; the list has been refreshed.' };
  return { fields: {}, message: err?.message || 'Something went wrong. Nothing was changed.' };
}

// The :id of /hr/departments/:id. Only plain positive whole numbers reach the API; anything else is shown as 'not found' without a request.
export function departmentIdFromParam(raw) {
  return /^[1-9]\d{0,14}$/.test(String(raw ?? '')) ? Number(raw) : null;
}
