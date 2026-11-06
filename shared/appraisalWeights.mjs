export const FULL_WEIGHT = 10000;

const sumWeights = rows => rows.reduce((total, row) => total + (row.weight ?? 0), 0);
const complete = row => Boolean(row.name.trim()) && Number.isInteger(row.weight);

export function appraisalWeightStatus(categories) {
  const total = sumWeights(categories);
  const groups = categories.map(category => {
    const total = sumWeights(category.criteria);
    return {
      id: category.id, total,
      ready: complete(category) && category.criteria.length > 0 &&
        category.criteria.every(complete) && total === FULL_WEIGHT,
    };
  });
  return { total, groups, ready: total === FULL_WEIGHT && groups.every(group => group.ready) };
}
