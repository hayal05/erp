export function tenure(start, today) {
  if (!start || !today || start > today) return 'Not started';
  const a = new Date(`${start}T00:00:00Z`), b = new Date(`${today}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) months--;
  months = Math.max(0, months);
  if (!months) return 'Less than a month';
  const years = Math.floor(months / 12), rest = months % 12;
  return [years && `${years} year${years === 1 ? '' : 's'}`, rest && `${rest} month${rest === 1 ? '' : 's'}`].filter(Boolean).join(', ');
}
export const employmentLabel = value => String(value ?? '').replaceAll('_', ' ');
