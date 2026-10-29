import {test} from 'node:test';
import assert from 'node:assert/strict';
import {payable,paymentPayload} from '../src/pages/settlementView.js';
const form={amount:'125.50',paymentDate:'2026-10-29',reference:' BANK-123 ',notes:' paid '};
test('payment input converts exact minor units and trims text',()=>{
 assert.deepEqual(paymentPayload(form,12550,'2026-10-29','pension','uuid').value,{kind:'pension',amountMinor:12550,paymentDate:'2026-10-29',reference:'BANK-123',notes:'paid',requestId:'uuid'});
});
test('zero, negative, excessive payments, future dates and blank references are rejected',()=>{
 for(const amount of ['0','-1','125.51','1.001'])assert.ok(paymentPayload({...form,amount},12550,'2026-10-29','pension','uuid').errors.amount);
 assert.ok(paymentPayload({...form,paymentDate:'2026-10-30'},12550,'2026-10-29','pension','uuid').errors.paymentDate);
 assert.ok(paymentPayload({...form,reference:' '},12550,'2026-10-29','pension','uuid').errors.reference);
});
test('tax and pension display their own due, paid and outstanding values',()=>{
 const row={incomeTaxMinor:100,incomeTaxSettledMinor:25,incomeTaxBalanceMinor:75,pensionMinor:200,pensionSettledMinor:50,pensionBalanceMinor:150};
 assert.deepEqual(payable(row,'income_tax'),{due:100,paid:25,balance:75});assert.deepEqual(payable(row,'pension'),{due:200,paid:50,balance:150});
});
