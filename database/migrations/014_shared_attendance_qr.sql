-- Shared short-lived QR: each employee can submit once per token.
-- Keep legacy token usage columns: old consumed tokens must remain invalid.
-- Receipts commit atomically with attendance and are removed with expired tokens.
CREATE TABLE attendance_token_scans (
  token_id bigint NOT NULL REFERENCES attendance_tokens(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, employee_id)
);
CREATE INDEX attendance_token_scans_employee_idx ON attendance_token_scans(employee_id);
