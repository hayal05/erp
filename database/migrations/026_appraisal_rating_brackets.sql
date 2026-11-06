CREATE TABLE appraisal_template_ratings (
  template_id bigint PRIMARY KEY REFERENCES appraisal_templates(id) ON DELETE CASCADE,
  brackets jsonb NOT NULL CHECK (jsonb_typeof(brackets) = 'array')
);
