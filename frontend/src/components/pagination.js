// Page maths for list screens. Matches the list contract planned for task 1.15:
// the API returns { items, page, pageSize, total } and the UI shows "from-to of total".
export function pageInfo({ page = 1, pageSize = 20, total = 0 } = {}) {
  const size = Math.max(1, Math.floor(pageSize) || 20);
  const count = Math.max(0, Math.floor(total) || 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return {
    page: p, pages,
    from: count === 0 ? 0 : (p - 1) * size + 1,
    to: Math.min(count, p * size),
    total: count,
    hasPrev: p > 1,
    hasNext: p < pages,
  };
}
