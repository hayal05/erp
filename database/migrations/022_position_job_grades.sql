CREATE TABLE position_job_grades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_id bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  basic_minor bigint NOT NULL CHECK (basic_minor BETWEEN 0 AND 9999999999999),
  allowance_minor bigint NOT NULL CHECK (allowance_minor BETWEEN 0 AND 9999999999999),
  UNIQUE (position_id, id)
);
CREATE UNIQUE INDEX position_job_grades_name_key ON position_job_grades(position_id, lower(btrim(name)));

ALTER TABLE employees ADD COLUMN job_grade_id bigint;
ALTER TABLE employees ADD CONSTRAINT employees_grade_needs_position CHECK (job_grade_id IS NULL OR position_id IS NOT NULL);
ALTER TABLE employees ADD CONSTRAINT employees_grade_position_fkey
  FOREIGN KEY (position_id, job_grade_id) REFERENCES position_job_grades(position_id, id);
CREATE INDEX employees_job_grade_idx ON employees(job_grade_id) WHERE job_grade_id IS NOT NULL;
