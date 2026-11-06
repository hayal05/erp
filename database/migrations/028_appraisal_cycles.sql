CREATE TABLE appraisal_cycles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('quarterly','annual','custom')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  due_on date NOT NULL,
  opened_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (starts_on <= ends_on AND ends_on <= due_on)
);

CREATE TABLE appraisal_assignments (
  cycle_id bigint NOT NULL REFERENCES appraisal_cycles(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL REFERENCES employees(id),
  reviewer_id bigint NOT NULL REFERENCES users(id),
  template_id bigint,
  template_version integer,
  PRIMARY KEY (cycle_id, employee_id),
  FOREIGN KEY (template_id, template_version)
    REFERENCES appraisal_template_publications(template_id, version) MATCH FULL
);
CREATE INDEX appraisal_assignments_reviewer_idx ON appraisal_assignments(reviewer_id);
