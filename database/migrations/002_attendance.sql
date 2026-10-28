-- 002_attendance: QR tokens (single-use, short-lived) and daily attendance records.

-- ----------------------------------------------------- attendance_tokens
-- Only the SHA-256 of the QR token is stored, so a database leak cannot be replayed.
-- A token is valid while used_at IS NULL and now() < expires_at, and only if the issuing
-- HR session still exists and is unlocked-as-issued. `used_at` is set inside the same
-- transaction that inserts/updates the attendance record, so a rolled-back submit leaves
-- the token usable (until it expires).
CREATE TABLE attendance_tokens (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash             text        NOT NULL,
  issued_by_session_id   text        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  issued_by_user_id      bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  used_at                timestamptz,
  used_by_employee_id    bigint      REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT attendance_tokens_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT attendance_tokens_use_consistent CHECK ((used_at IS NULL) = (used_by_employee_id IS NULL))
);
CREATE UNIQUE INDEX attendance_tokens_hash_key ON attendance_tokens (token_hash);
CREATE INDEX attendance_tokens_session_idx ON attendance_tokens (issued_by_session_id);
CREATE INDEX attendance_tokens_expires_idx ON attendance_tokens (expires_at);

-- --------------------------------------------------- attendance_records
-- One row per employee per work date (company timezone date, computed by the server).
-- Check-in and check-out update the same row. Absent / on_leave rows may exist without any
-- check-in (written by the classification job, Phase 3). Selfie columns hold Cloudinary
-- public ids, never URLs: signed expiring URLs are generated on demand (task 2.9).
CREATE TABLE attendance_records (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id          bigint      NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  work_date            date        NOT NULL,
  check_in_at          timestamptz,
  check_out_at         timestamptz,
  check_in_photo_id    text,
  check_out_photo_id   text,
  status               text        NOT NULL
                       CHECK (status IN ('present', 'late', 'absent', 'on_leave', 'incomplete')),
  late_minutes         integer     NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  -- correction info (HR edits; every correction also writes an audit_logs row)
  corrected_by_user_id bigint      REFERENCES users(id) ON DELETE SET NULL,
  corrected_at         timestamptz,
  correction_reason    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_one_per_day UNIQUE (employee_id, work_date),
  CONSTRAINT attendance_out_needs_in CHECK (check_out_at IS NULL OR check_in_at IS NOT NULL),
  CONSTRAINT attendance_out_after_in CHECK (check_out_at IS NULL OR check_out_at > check_in_at),
  CONSTRAINT attendance_worked_needs_in CHECK (status NOT IN ('present', 'late') OR check_in_at IS NOT NULL),
  CONSTRAINT attendance_late_only_when_late CHECK (late_minutes = 0 OR status = 'late'),
  CONSTRAINT attendance_correction_complete CHECK (
    (corrected_at IS NULL AND corrected_by_user_id IS NULL AND correction_reason IS NULL)
    OR (corrected_at IS NOT NULL AND btrim(coalesce(correction_reason, '')) <> ''))
);
CREATE INDEX attendance_date_idx ON attendance_records (work_date);
CREATE INDEX attendance_status_date_idx ON attendance_records (status, work_date);
CREATE TRIGGER attendance_records_updated_at BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
