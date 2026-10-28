import { v } from '../middleware/validate.js';

// Shared list contract (matches the frontend Pager): { items, page, pageSize, total }.
export const pageSchema = {
  page: v.int({ min: 1, max: 100_000, default: 1 }),
  pageSize: v.int({ min: 1, max: 100, default: 25 }),
};
export const pageOffset = ({ page, pageSize }) => (page - 1) * pageSize;
export const pageResult = (items, { page, pageSize }, total) => ({ items, page, pageSize, total });

// Pattern for `ILIKE $n ESCAPE '\'`: the user's %, _ and \ match themselves, not as wildcards.
export const likePattern = (text) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

// Builds "col = $n" fragments from a whitelist (camelCase key -> column). Only keys present in
// `data` are used and column names come from the whitelist, never from the request.
export function setClause(columns, data, firstParam = 2) {
  const keys = Object.keys(columns).filter((k) => Object.hasOwn(data, k));
  return { sets: keys.map((k, i) => `${columns[k]} = $${firstParam + i}`), params: keys.map((k) => data[k]) };
}
