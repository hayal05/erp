CREATE TABLE appraisal_reviews (
  cycle_id bigint NOT NULL,
  employee_id bigint NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  inputs jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 4000),
  result jsonb,
  submitted_at timestamptz,
  PRIMARY KEY (cycle_id, employee_id),
  FOREIGN KEY (cycle_id, employee_id) REFERENCES appraisal_assignments(cycle_id, employee_id),
  CHECK ((submitted_at IS NULL) = (result IS NULL)),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);
