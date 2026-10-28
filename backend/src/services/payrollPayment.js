import { parse, v } from '../middleware/validate.js';
export function parsePayment(body) {
  const result = parse({ paidOn: v.date({ required: true }) }, body);
  if (result.errors) return result;
  if (!/^[1-9]\d{3}-/.test(result.value.paidOn)) return { errors: { paidOn: 'Use a year from 1000 to 9999' } };
  return result;
}
