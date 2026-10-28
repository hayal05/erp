-- 003_leave: leave types, yearly balances, leave requests, company holidays.
-- MVP decisions (documented in plan/project status.md): leave is in WHOLE working days, and one request must stay inside one
-- calendar year, so a balance is always charged to exactly one year.

-- Needed for the "no overlapping approved leave" exclusion constraint below (equality on employee_id inside a GiST index).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------- leave_types
-- has_balance = false means the type is not limited by an entitlement (unpaid leave). is_paid feeds payroll in Phase 4.
CREATE TABLE leave_types (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text    NOT NULL CHECK (code ~ '^[a-z_]+$'),
  name         text    NOT NULL CHECK (btrim(name) <> ''),
  is_paid      boolean NOT NULL DEFAULT true,
  has_balance  boolean NOT NULL DEFAULT true,
  default_days integer NOT NULL DEFAULT 0 CHECK (default_days >= 0 AND (has_balance OR default_days = 0)),
  CONSTRAINT leave_types_code_key UNIQUE (code)
);
-- The four types from the spec. Default entitlements are illustrative: HR sets the real ones per employee.
INSERT INTO leave_types (code, name, is_paid, has_balance, default_days) VALUES
  ('annual',   'Annual leave',   true,  true,  16),
  ('sick',     'Sick leave',     true,  true,  10),
  ('personal', 'Personal leave', true,  true,  5),
  ('unpaid',   'Unpaid leave',   false, false, 0);

-- -------------------------------------------------------- leave_balances
-- One row per employee, leave type and year. Only the ENTITLEMENT is stored (plus HR's signed adjustment); days used and
-- pending are always computed from leave_requests, so a balance can never drift from the requests behind it.
-- Every adjustment is also written to audit_logs with its mandatory reason.
CREATE TABLE leave_balances (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id   bigint  NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type_id bigint  NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  year          integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  entitled_days integer NOT NULL DEFAULT 0 CHECK (entitled_days >= 0),
  adjusted_days integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_balances_unique UNIQUE (employee_id, leave_type_id, year),
  CONSTRAINT leave_balances_not_negative CHECK (entitled_days + adjusted_days >= 0)
);
CREATE TRIGGER leave_balances_updated_at BEFORE UPDATE ON leave_balances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------- leave_requests
-- `days` is the working-day count calculated by the server when the request is made (shift work days minus holidays) and
-- kept as a snapshot, so a later holiday change does not silently alter an approved request.
CREATE TABLE leave_requests (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id        bigint  NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type_id      bigint  NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date         date    NOT NULL,
  end_date           date    NOT NULL,
  days               integer NOT NULL CHECK (days >= 1),
  reason             text    NOT NULL CHECK (btrim(reason) <> ''),
  status             text    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_user_id bigint  REFERENCES users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  decision_remarks   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_dates_ordered CHECK (end_date >= start_date),
  CONSTRAINT leave_requests_one_year CHECK (extract(year FROM start_date) = extract(year FROM end_date)),
  -- pending has no decision yet; approved/rejected need one (and a rejection needs remarks); cancelled is the employee's own
  CONSTRAINT leave_requests_decision_consistent CHECK (
    CASE status
      WHEN 'pending'  THEN decided_at IS NULL
      WHEN 'approved' THEN decided_at IS NOT NULL
      WHEN 'rejected' THEN decided_at IS NOT NULL AND btrim(coalesce(decision_remarks, '')) <> ''
      ELSE true
    END)
);
CREATE INDEX leave_requests_employee_idx ON leave_requests (employee_id, start_date);
CREATE INDEX leave_requests_status_idx ON leave_requests (status, start_date);
CREATE TRIGGER leave_requests_updated_at BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Backstop for "no overlapping approved leave" (spec 10): even two simultaneous approvals cannot both succeed.
-- The API (3.3/3.4) checks first for a friendly message; this constraint is what guarantees it. Violation = SQLSTATE 23P01.
ALTER TABLE leave_requests ADD CONSTRAINT leave_no_overlapping_approved
  EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (status = 'approved');

-- ---------------------------------------------------------------- holidays
-- Company holidays: excluded from leave day counts (3.2) and from absence classification (3.8).
CREATE TABLE holidays (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  holiday_date date NOT NULL,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holidays_date_key UNIQUE (holiday_date)
);
