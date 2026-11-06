import test from 'node:test';
import assert from 'node:assert/strict';
import { appraisalBracketStatus, appraisalRating, parseMandatoryRule, parseRatingBrackets } from '../../shared/appraisalRatings.mjs';

const brackets = [
  { label: 'Needs improvement', min: 0, max: 6000 },
  { label: 'Meets expectations', min: 6000, max: 9000 },
  { label: 'Exceeds expectations', min: 9000, max: 10000 },
];

test('brackets are contiguous, include 100%, and rate at two-decimal boundaries', () => {
  assert.equal(appraisalBracketStatus([...brackets].reverse()).ready, true);
  for (const [score, index] of [[0, 0], [59.99, 0], [60, 1], [89.995, 2], [100, 2]]) {
    assert.equal(appraisalRating(score, brackets).label, brackets[index].label);
  }
});

test('gap, overlap and unfinished rows prevent assigning a rating', () => {
  const gap = [brackets[0], { ...brackets[1], min: 6100 }, brackets[2]];
  const overlap = [brackets[0], { ...brackets[1], min: 5900 }, brackets[2]];
  assert.match(appraisalBracketStatus(gap).errors[0], /Gap/);
  assert.match(appraisalBracketStatus(overlap).errors[0], /Overlap/);
  assert.equal(appraisalRating(75, gap), null);
  assert.equal(appraisalBracketStatus(parseRatingBrackets([{ label: '', min: 0, max: null }])).ready, false);
  assert.throws(() => parseRatingBrackets([{ label: 'Invalid', min: -1, max: 10000 }]), /between 0 and 100/);
});

test('mandatory criteria apply the strictest ceiling and preserve the weighted score', () => {
  const criteria = [
    { id: 'quality', mandatory: parseMandatoryRule({ minimum: 7000, ceiling: 8999 }), result: { status: 'scored', score: 69 } },
    { id: 'safety', mandatory: parseMandatoryRule({ minimum: 8000, ceiling: 5999 }), result: { status: 'excluded' } },
  ];
  assert.deepEqual(appraisalRating(96, brackets, criteria), {
    label: 'Needs improvement', score: 96, ratingScore: 59.99, cappedBy: ['quality', 'safety'],
  });
  assert.equal(appraisalRating(96, brackets, [{ ...criteria[0], result: { status: 'scored', score: 70 } }]).ratingScore, 96);
  assert.throws(() => parseMandatoryRule({ minimum: null, ceiling: 5900 }), /minimum score/);
});
