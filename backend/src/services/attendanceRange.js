// Bound both the data and count queries using the company date, never the browser clock.
export function attendanceRange(query, today) {
  if (query.view === 'today') return { from: today, to: today };
  if (query.view !== 'archive') return {};
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const yesterday = date.toISOString().slice(0, 10);
  return { to: query.to && query.to < yesterday ? query.to : yesterday };
}
