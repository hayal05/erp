import { formatMoney, parseMoney } from '../api/money.js';
export function profileForm(profile) {
  return { basic: formatMoney(profile.basicMinor), allowance: formatMoney(profile.allowanceMinor), allowanceTaxable: profile.allowanceTaxable, allowancePensionable: profile.allowancePensionable, pensionApplies: profile.pensionApplies };
}
export function profilePayload(form) {
  const errors = {}, value = {};
  for (const key of ['basic', 'allowance']) {
    try { value[`${key}Minor`] = parseMoney(form[key]); } catch (e) { errors[key] = e.message; }
  }
  for (const key of ['allowanceTaxable', 'allowancePensionable', 'pensionApplies']) value[key] = form[key];
  return Object.keys(errors).length ? { errors } : { value };
}
