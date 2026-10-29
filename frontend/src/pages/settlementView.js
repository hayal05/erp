import { parseMoney } from '../api/money.js';
export const settlementLabel = kind => kind === 'income_tax' ? 'Income tax' : 'Pension';
export function payable(row,kind) {
  return kind==='income_tax' ? {due:row.incomeTaxMinor,paid:row.incomeTaxSettledMinor,balance:row.incomeTaxBalanceMinor}
    : {due:row.pensionMinor,paid:row.pensionSettledMinor,balance:row.pensionBalanceMinor};
}
export function paymentPayload(form,balance,today,kind,requestId) {
  const errors={};let amountMinor;
  try{amountMinor=parseMoney(form.amount);if(amountMinor===0)errors.amount='Enter an amount greater than zero';else if(amountMinor>balance)errors.amount='Amount exceeds the remaining balance';}catch(e){errors.amount=e.message;}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(form.paymentDate)||form.paymentDate>today)errors.paymentDate='Choose today or an earlier payment date';
  if(!form.reference.trim())errors.reference='Enter the payment reference';
  return Object.keys(errors).length?{errors}:{value:{kind,amountMinor,paymentDate:form.paymentDate,reference:form.reference.trim(),notes:form.notes.trim(),requestId}};
}
