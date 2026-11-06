export const SCORE_METHODS = ['rating', 'higher', 'lower', 'yes_no', 'lookup'];
export const MISSING_POLICIES = ['required', 'zero', 'exclude'];

export function defaultScoringRule(method = 'rating') {
  const base = { method, cap: 100, missing: 'required', allowNotApplicable: false };
  if (method === 'higher' || method === 'lower') return { ...base, target: 100 };
  if (method === 'yes_no') return { ...base, yesScore: 100, noScore: 0 };
  if (method === 'lookup') return { ...base, belowScore: 0, thresholds: [{ minimum: 0, score: 100 }] };
  return base;
}

const validScore = value => Number.isFinite(value) && value >= 0 && value <= 100;

export function parseScoringRule(value) {
  if (!value || !SCORE_METHODS.includes(value.method)) throw new Error('Choose a scoring method');
  const { method, cap, missing, allowNotApplicable } = value;
  if (!validScore(cap)) throw new Error('Score cap must be between 0 and 100');
  if (!MISSING_POLICIES.includes(missing)) throw new Error('Choose a missing input policy');
  if (typeof allowNotApplicable !== 'boolean') throw new Error('Choose whether to allow not applicable');
  const base = { method, cap, missing, allowNotApplicable };
  if (method === 'higher' || method === 'lower') {
    if (!Number.isFinite(value.target) || value.target < 0 || (method === 'higher' && value.target === 0)) {
      throw new Error(method === 'higher' ? 'Enter a target greater than zero' : 'Enter a target of zero or higher');
    }
    return { ...base, target: value.target };
  }
  if (method === 'yes_no') {
    if (!validScore(value.yesScore) || !validScore(value.noScore)) throw new Error('Yes and No scores must be between 0 and 100');
    return { ...base, yesScore: value.yesScore, noScore: value.noScore };
  }
  if (method === 'lookup') {
    if (!validScore(value.belowScore)) throw new Error('Score below the first threshold must be between 0 and 100');
    if (!Array.isArray(value.thresholds) || !value.thresholds.length) throw new Error('Add at least one threshold');
    const thresholds = value.thresholds.map(row => {
      if (!Number.isFinite(row?.minimum) || !validScore(row?.score)) {
        throw new Error('Each threshold needs a number and a score between 0 and 100');
      }
      return { minimum: row.minimum, score: row.score };
    }).sort((a, b) => a.minimum - b.minimum);
    if (new Set(thresholds.map(row => row.minimum)).size !== thresholds.length) throw new Error('Thresholds must be unique');
    return { ...base, belowScore: value.belowScore, thresholds };
  }
  return base;
}

export function scoringRuleError(rule) {
  try {
    parseScoringRule(rule);
    return '';
  } catch (error) {
    return error.message;
  }
}

// Score one criterion. Exclusions carry no score so the aggregate can handle them explicitly.
export function scoreAppraisalCriterion(rule, actual, { notApplicable = false } = {}) {
  const config = parseScoringRule(rule ?? defaultScoringRule());
  const scored = value => ({ status: 'scored', score: Math.min(config.cap, value) });
  if (notApplicable) return { status: config.allowNotApplicable ? 'excluded' : 'invalid' };
  if (actual == null) {
    if (config.missing === 'zero') return scored(0);
    return { status: config.missing === 'exclude' ? 'excluded' : 'missing' };
  }
  if (config.method === 'yes_no') return typeof actual === 'boolean' ? scored(actual ? config.yesScore : config.noScore) : { status: 'invalid' };
  if (!Number.isFinite(actual)) return { status: 'invalid' };
  if (config.method === 'lookup') {
    const matched = config.thresholds.findLast(row => actual >= row.minimum);
    return scored(matched?.score ?? config.belowScore);
  }
  if (actual < 0) return { status: 'invalid' };
  if (config.method === 'higher') return scored(actual / config.target * 100);
  if (config.method === 'lower') return scored(actual === 0 ? 100 : config.target / actual * 100);
  return actual <= 100 ? scored(actual) : { status: 'invalid' };
}
