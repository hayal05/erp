export const templateTargets = {
  department: { table: 'departments', column: 'department_id', from: 'FROM departments t', label: 't.name' },
  position: { table: 'positions', column: 'position_id', from: 'FROM positions t JOIN departments d ON d.id=t.department_id',
    label: "d.name || ' · ' || t.name" },
  grade: { table: 'position_job_grades', column: 'job_grade_id',
    from: 'FROM position_job_grades t JOIN positions p ON p.id=t.position_id JOIN departments d ON d.id=p.department_id',
    label: "d.name || ' · ' || p.name || ' · ' || t.name" },
};

export function toAppraisalTemplate(row) {
  const target = Object.entries(templateTargets).find(([, config]) => row[config.column] != null);
  return {
    id: Number(row.id), name: row.name, version: row.version,
    scope: target?.[0] ?? 'company', targetId: target ? Number(row[target[1].column]) : null,
    targetName: row.target_name ?? null,
  };
}

// Resolve candidates at the highest matching level. Keep ties explicit for configuration review.
export const appraisalMatchJoin = `
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS candidate_count, min(name) AS candidate_name, min(id) AS candidate_id,
      min(priority) AS priority
    FROM (
      SELECT id, name, rank() OVER (ORDER BY priority DESC) AS rank, priority
      FROM (
        SELECT id, name, CASE WHEN job_grade_id IS NOT NULL THEN 3 WHEN position_id IS NOT NULL THEN 2
          WHEN department_id IS NOT NULL THEN 1 ELSE 0 END AS priority
        FROM appraisal_templates
        WHERE job_grade_id=e.job_grade_id OR position_id=e.position_id OR department_id=e.department_id
          OR num_nonnulls(department_id,position_id,job_grade_id)=0
      ) candidates
    ) ranked WHERE rank=1
  ) match ON TRUE`;

export function toAppraisalMatch(row) {
  if (!row.candidate_count) return { status: 'missing' };
  const scope = ['company', 'department', 'position', 'grade'][row.priority];
  return row.candidate_count === 1
    ? { status: 'matched', scope, id: Number(row.candidate_id), name: row.candidate_name }
    : { status: 'conflict', scope, count: row.candidate_count };
}
