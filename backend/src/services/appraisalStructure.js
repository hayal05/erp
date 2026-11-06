import { parse, v } from '../middleware/validate.js';
import { validationError } from './dbErrors.js';
import { appraisalWeightStatus, FULL_WEIGHT } from '../../../shared/appraisalWeights.mjs';

import { parseScoringRule } from '../../../shared/appraisalScoring.mjs';

const fields = {
  id: v.string({ required: true, pattern: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i }),
  name: v.string({ max: 120, default: '' }),
  weight: v.int({ min: 0, max: FULL_WEIGHT, nullable: true, default: null }),
};

export function structureBody(req, _res, next) {
  const { version, categories } = req.body ?? {};
  if (!Number.isSafeInteger(version) || version < 1 || !Array.isArray(categories)) {
    return next(validationError({ categories: 'Provide the draft version and a list of categories' }));
  }
  const seen = new Set();
  function read(row) {
    const { value, errors } = parse(fields, row);
    if (errors) return null;
    value.id = value.id.toLowerCase();
    if (seen.has(value.id)) return null;
    seen.add(value.id);
    return value;
  }
  const normalized = [];
  for (const category of categories) {
    const group = read(category);
    if (!group || !Array.isArray(category.criteria)) {
      return next(validationError({ categories: 'Each category needs a unique ID, a valid weight, and a list of criteria' }));
    }
    group.criteria = [];
    for (const criterion of category.criteria) {
      const item = read(criterion);
      if (!item) return next(validationError({ categories: 'Each criterion needs a unique ID and a valid weight' }));
      if (Object.hasOwn(criterion, 'scoring')) {
        try {
          item.scoring = parseScoringRule(criterion.scoring);
        } catch (error) {
          return next(validationError({ categories: `${item.name || 'Criterion'}: ${error.message}` }));
        }
      }
      group.criteria.push(item);
    }
    normalized.push(group);
  }
  req.body = { version, categories: normalized };
  next();
}

export const structureResult = (version, categories) => ({
  version, categories, weights: appraisalWeightStatus(categories),
});
