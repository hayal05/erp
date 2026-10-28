import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validMonth, paymentDateError, workflowAction, localDate } from '../src/pages/payrollWorkflowView.js';
test('workflow buttons follow server status and reject empty-draft approval', () => {
  assert.equal(workflowAction(null), 'generate');
  assert.equal(workflowAction({status:'draft'},false,2),'approve');
  assert.equal(workflowAction({status:'draft'},false,0),null);
  assert.equal(workflowAction({status:'approved'}),'pay');
  assert.equal(workflowAction({status:'paid'}),null);
  assert.equal(workflowAction(null,true),null);
});
test('month selector accepts calendar months, not date rollover or unsafe links', () => {
  assert.ok(validMonth('2026-12'));
  for(const s of ['2026-13','2026-00','2026-1','0000-01','2026-01-01',null]) assert.ok(!validMonth(s));
});
test('payment form validates leap days and preserves date-only formatting', () => {
  assert.equal(paymentDateError('2028-02-29'),'');
  for(const s of ['2026-02-29','2026-04-31','2026-13-01','',null,'2026-10-28T12:00:00Z']) assert.ok(paymentDateError(s));
  assert.equal(localDate(new Date(2026,0,5,12)), '2026-01-05');
});
