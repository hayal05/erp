export const validMonth = (s) => typeof s === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(s);
export const localDate = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
export function paymentDateError(s) {
  if (typeof s !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(s)) return 'Enter a date in YYYY-MM-DD format';
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== s ? 'Enter a real calendar date' : '';
}
export function workflowAction(period, loading = false, total = 0) {
  if (loading) return null;
  if (!period) return 'generate';
  if (period.status === 'draft' && total > 0) return 'approve';
  if (period.status === 'approved') return 'pay';
  return null;
}
