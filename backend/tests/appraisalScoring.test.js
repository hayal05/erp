import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScoringRule, parseScoringRule, scoreAppraisalCriterion } from '../../shared/appraisalScoring.mjs';

const rule = (method, options) => ({ ...defaultScoringRule(method), ...options });
const scored = score => ({ status: 'scored', score });

test('ratings, higher and lower target ratios, zero targets and score caps', () => {
  assert.deepEqual(scoreAppraisalCriterion(null, 75), scored(75));
  assert.deepEqual(scoreAppraisalCriterion(null, 101), { status: 'invalid' });
  assert.deepEqual(scoreAppraisalCriterion(rule('higher', { target: 50, cap: 90 }), 100), scored(90));
  assert.deepEqual(scoreAppraisalCriterion(rule('higher', { target: 50 }), 25), scored(50));
  assert.deepEqual(scoreAppraisalCriterion(rule('lower', { target: 10 }), 20), scored(50));
  assert.deepEqual(scoreAppraisalCriterion(rule('lower', { target: 0 }), 1), scored(0));
  assert.deepEqual(scoreAppraisalCriterion(rule('lower', { target: 0 }), 0), scored(100));
  assert.throws(() => parseScoringRule(rule('higher', { target: 0 })), /greater than zero/);
});

test('Yes and No, missing and not-applicable inputs stay distinct', () => {
  const binary = rule('yes_no', { yesScore: 80, noScore: 20, missing: 'zero' });
  assert.deepEqual(scoreAppraisalCriterion(binary, true), scored(80));
  assert.deepEqual(scoreAppraisalCriterion(binary, false), scored(20));
  assert.deepEqual(scoreAppraisalCriterion(binary, null), scored(0));
  assert.deepEqual(scoreAppraisalCriterion(binary, 'false'), { status: 'invalid' });
  assert.deepEqual(scoreAppraisalCriterion(null, null), { status: 'missing' });
  assert.deepEqual(scoreAppraisalCriterion(rule('rating', { missing: 'exclude' }), null), { status: 'excluded' });
  assert.deepEqual(scoreAppraisalCriterion(binary, null, { notApplicable: true }), { status: 'invalid' });
  assert.deepEqual(scoreAppraisalCriterion({ ...binary, allowNotApplicable: true }, null, { notApplicable: true }), { status: 'excluded' });
});

test('lookup thresholds include exact boundaries, normalize order and reject ties', () => {
  const config = rule('lookup', { belowScore: 10, thresholds: [{ minimum: 20, score: 90 }, { minimum: -5, score: 50 }] });
  assert.deepEqual(scoreAppraisalCriterion(config, -6), scored(10));
  assert.deepEqual(scoreAppraisalCriterion(config, -5), scored(50));
  assert.deepEqual(scoreAppraisalCriterion(config, 19.9), scored(50));
  assert.deepEqual(scoreAppraisalCriterion(config, 20), scored(90));
  assert.throws(() => parseScoringRule({ ...config, thresholds: [...config.thresholds, { minimum: 20, score: 80 }] }), /unique/);
});
