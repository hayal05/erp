// Work with calendar dates in UTC so the browser's timezone cannot shift a report boundary.
export function reportPeriodRange(period, value) {
  if (!value) return { from: '', to: '' };
  if (period === 'monthly') {
    const end = new Date(`${value}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return { from: `${value}-01`, to: end.toISOString().slice(0, 10) };
  }
  const start = new Date(`${value}T00:00:00Z`);
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const from = start.toISOString().slice(0, 10);
  start.setUTCDate(start.getUTCDate() + 6);
  return { from, to: start.toISOString().slice(0, 10) };
}
