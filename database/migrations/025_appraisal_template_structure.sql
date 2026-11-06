CREATE TABLE appraisal_template_structures (
  template_id bigint PRIMARY KEY REFERENCES appraisal_templates(id) ON DELETE CASCADE,
  categories jsonb NOT NULL CHECK (jsonb_typeof(categories) = 'array')
);
