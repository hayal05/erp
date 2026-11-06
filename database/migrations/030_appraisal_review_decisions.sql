ALTER TABLE appraisal_reviews
  ADD COLUMN returned_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by bigint REFERENCES users(id),
  ADD CONSTRAINT appraisal_review_approval_consistent CHECK (
    (approved_at IS NULL) = (approved_by IS NULL) AND (approved_at IS NULL OR submitted_at IS NOT NULL)
  ),
  ADD CONSTRAINT appraisal_review_return_consistent CHECK (returned_at IS NULL OR submitted_at IS NULL);
