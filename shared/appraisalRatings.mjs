import { FULL_WEIGHT } from './appraisalWeights.mjs';

const validBoundary = value => Number.isInteger(value) && value >= 0 && value <= FULL_WEIGHT;
const toPoints = value => Math.round((value + Number.EPSILON * value) * 100);
const percent = value => (value / 100).toFixed(2) + '%';

export function parseRatingBrackets(brackets) {
  if (!Array.isArray(brackets)) throw new Error('Provide a list of rating brackets');
  return brackets.map(row => {
    if (!row || typeof row.label !== 'string' || row.label.trim().length > 120 ||
      ![row.min, row.max].every(value => value === null || validBoundary(value))) {
      throw new Error('Each bracket needs a label and boundaries between 0 and 100%');
    }
    return { label: row.label.trim(), min: row.min, max: row.max };
  });
}

export function appraisalBracketStatus(brackets) {
  const errors = [];
  if (!brackets.length) return { ready: false, errors: ['Add rating brackets covering 0% to 100%.'] };
  const valid = [];
  brackets.forEach((row, index) => {
    if (!row.label.trim() || !validBoundary(row.min) || !validBoundary(row.max) || row.min >= row.max) {
      errors.push(`Bracket ${index + 1} needs a label and a lower boundary below its upper boundary.`);
    } else valid.push(row);
  });
  let covered = 0;
  for (const row of valid.sort((a, b) => a.min - b.min)) {
    if (row.min > covered) errors.push(`Gap between ${percent(covered)} and ${percent(row.min)}.`);
    if (row.min < covered) errors.push(`Overlap starting at ${percent(row.min)}.`);
    covered = Math.max(covered, row.max);
  }
  if (covered < FULL_WEIGHT) errors.push(`Gap between ${percent(covered)} and 100%.`);
  return { ready: errors.length === 0, errors: [...new Set(errors)] };
}

export function parseMandatoryRule(rule) {
  if (rule === null) return null;
  if (!rule || !validBoundary(rule.minimum) || !validBoundary(rule.ceiling)) {
    throw new Error('Mandatory criteria need a minimum score and a rating ceiling between 0 and 100%');
  }
  return { minimum: rule.minimum, ceiling: rule.ceiling };
}

// Round once to two decimals for rating boundaries. Keep the weighted score separate from the rating ceiling.
export function appraisalRating(score, brackets, criteria = []) {
  if (!Number.isFinite(score) || score < 0 || score > 100 || !appraisalBracketStatus(brackets).ready) return null;
  const points = toPoints(score);
  const failed = criteria.filter(({ mandatory, result }) => mandatory &&
    (result.status !== 'scored' || toPoints(result.score) < mandatory.minimum));
  const ratingPoints = Math.min(points, ...failed.map(({ mandatory }) => mandatory.ceiling));
  const bracket = brackets.find(({ min, max }) => ratingPoints >= min &&
    (ratingPoints < max || (ratingPoints === FULL_WEIGHT && max === FULL_WEIGHT)));
  return { label: bracket.label, score: points / 100, ratingScore: ratingPoints / 100,
    cappedBy: failed.filter(({ mandatory }) => mandatory.ceiling < points).map(({ id }) => id) };
}
