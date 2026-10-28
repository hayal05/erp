// State for the toast stack, kept pure so it can be tested. Newest last; oldest dropped past the cap.
export const MAX_TOASTS = 4;
export const DURATION = { info: 4000, success: 4000, error: 7000 }; // errors stay longer

export function toastsReducer(list, action) {
  if (action.type === 'add') return [...list, action.toast].slice(-MAX_TOASTS);
  if (action.type === 'remove') return list.filter((t) => t.id !== action.id);
  return list;
}
