import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScoringRule } from '../../shared/appraisalScoring.mjs';
import { previewAppraisal } from '../../shared/appraisalPreview.mjs';

const brackets = [{ label: 'Developing', min: 0, max: 6000 }, { label: 'Ready', min: 6000, max: 10000 }];
const criterion = (id, weight, extra = {}) => ({ id, name: id, weight, ...extra });
const groups = [
  { id: 'work', name: 'Work', weight: 6000, criteria: [criterion('volume', 5000), criterion('accuracy', 5000)] },
  { id: 'safety', name: 'Safety', weight: 4000, criteria: [criterion('compliance', 10000, { mandatory: { minimum: 8000, ceiling: 5999 } })] },
];

test('preview shows criterion and category contributions with a separate mandatory rating ceiling', () => {
  const result = previewAppraisal(groups, brackets, { volume: { value: 100 }, accuracy: { value: 80 }, compliance: { value: 75 } });
  assert.equal(result.status, 'scored');
  assert.deepEqual(result.categories[0].criteria.map(row => row.contribution), [50, 40]);
  assert.deepEqual(result.categories.map(row => row.contribution), [54, 30]);
  assert.deepEqual(result.rating, { label: 'Developing', score: 84, ratingScore: 59.99, cappedBy: ['compliance'] });
});

test('missing inputs block scoring and excluded criteria redistribute their weight', () => {
  assert.equal(previewAppraisal(groups, brackets, { volume: { value: 90 } }).status, 'incomplete');
  const categories = structuredClone(groups);
  categories[0].criteria[1].scoring = { ...defaultScoringRule(), missing: 'exclude' };
  categories[1].criteria[0].scoring = { ...defaultScoringRule(), allowNotApplicable: true };
  const result = previewAppraisal(categories, brackets, { volume: { value: 90 }, compliance: { notApplicable: true } });
  assert.equal(result.rating.score, 90);
  assert.equal(result.rating.ratingScore, 59.99);
  assert.equal(result.categories[1].score, null);
  assert.equal(previewAppraisal(categories, [], {}).status, 'configuration');
});
