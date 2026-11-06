CREATE TABLE appraisal_templates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  department_id bigint REFERENCES departments(id) ON DELETE RESTRICT,
  position_id bigint REFERENCES positions(id) ON DELETE RESTRICT,
  job_grade_id bigint REFERENCES position_job_grades(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (num_nonnulls(department_id, position_id, job_grade_id) <= 1)
);
CREATE INDEX appraisal_templates_department_idx ON appraisal_templates(department_id);
CREATE INDEX appraisal_templates_position_idx ON appraisal_templates(position_id);
CREATE INDEX appraisal_templates_grade_idx ON appraisal_templates(job_grade_id);
