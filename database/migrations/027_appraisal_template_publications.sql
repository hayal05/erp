CREATE TABLE appraisal_template_publications (
  template_id bigint NOT NULL REFERENCES appraisal_templates(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by bigint NOT NULL REFERENCES users(id),
  PRIMARY KEY (template_id, version)
);

CREATE FUNCTION reject_appraisal_publication_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published appraisal templates are immutable';
END;
$$;
CREATE TRIGGER appraisal_template_publications_immutable
  BEFORE UPDATE OR DELETE ON appraisal_template_publications
  FOR EACH ROW EXECUTE FUNCTION reject_appraisal_publication_change();
