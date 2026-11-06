import { appraisalBracketStatus, appraisalRating } from './appraisalRatings.mjs';
import { scoreAppraisalCriterion } from './appraisalScoring.mjs';
import { appraisalWeightStatus } from './appraisalWeights.mjs';

export function previewAppraisal(categories, brackets, inputs) {
  if (!appraisalWeightStatus(categories).ready || !appraisalBracketStatus(brackets).ready) {
    return { status: 'configuration', categories: [] };
  }

  const groups = categories.map(category => {
    const rows = category.criteria.map(criterion => ({
      id: criterion.id, weight: criterion.weight, mandatory: criterion.mandatory,
      result: scoreAppraisalCriterion(criterion.scoring, inputs[criterion.id]?.value, {
        notApplicable: inputs[criterion.id]?.notApplicable,
      }),
    }));
    const weight = rows.reduce((sum, row) => sum + (row.result.status === 'scored' ? row.weight : 0), 0);
    const blocked = rows.some(row => ['missing', 'invalid'].includes(row.result.status));
    const criteria = rows.map(row => ({
      ...row, contribution: weight && !blocked && row.result.status === 'scored' ? row.result.score * row.weight / weight : null,
    }));
    const score = weight && !blocked ? criteria.reduce((sum, row) => sum + (row.contribution ?? 0), 0) : null;
    return { id: category.id, weight: category.weight, score, blocked, criteria };
  });
  const weight = groups.reduce((sum, group) => sum + (group.score === null ? 0 : group.weight), 0);
  const breakdown = groups.map(group => ({
    ...group, contribution: weight && group.score !== null ? group.score * group.weight / weight : null,
  }));
  if (groups.some(group => group.blocked)) return { status: 'incomplete', categories: breakdown };
  if (!weight) return { status: 'excluded', categories: breakdown };
  const score = Math.min(100, breakdown.reduce((sum, group) => sum + (group.contribution ?? 0), 0));
  return { status: 'scored', categories: breakdown,
    rating: appraisalRating(score, brackets, groups.flatMap(group => group.criteria)) };
}
