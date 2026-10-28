-- 001_core: identity, sessions, org structure, employees, audit trail.
-- Two roles only ('hr', 'employee'). There is deliberately no kiosk role: the office
-- tablet is an HR session whose `sessions.locked` flag is enforced server-side.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text        NOT NULL CHECK (email = btrim(email) AND email <> ''),
  full_name     text        NOT NULL CHECK (btrim(full_name) <> ''),
  password_hash text        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('hr', 'employee')),
  is_active     boolean     NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------- sessions
-- `id` is the SHA-256 of the cookie token, so a database leak does not expose live sessions.
CREATE TABLE sessions (
  id           text        PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text        NOT NULL,
  locked       boolean     NOT NULL DEFAULT false,   -- tablet QR lock, per session
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CONSTRAINT sessions_lock_consistent CHECK (locked = (locked_at IS NOT NULL))
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------- departments
CREATE TABLE departments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text        NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX departments_name_key ON departments (lower(name));

-- --------------------------------------------------------------- shifts
-- Work schedules. MVP supports same-day shifts only (end_time > start_time).
-- work_days uses ISO weekday numbers: 1 = Monday ... 7 = Sunday.
CREATE TABLE shifts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text        NOT NULL CHECK (btrim(name) <> ''),
  start_time    time        NOT NULL,
  end_time      time        NOT NULL,
  grace_minutes integer     NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 240),
  work_days     smallint[]  NOT NULL DEFAULT '{1,2,3,4,5}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shifts_same_day CHECK (end_time > start_time),
  CONSTRAINT shifts_work_days_valid CHECK (
    cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);
CREATE UNIQUE INDEX shifts_name_key ON shifts (lower(name));

-- Illustrative default so a new employee always has a schedule; HR edits it in Settings.
INSERT INTO shifts (name, start_time, end_time, grace_minutes, work_days)
VALUES ('Standard', '09:00', '17:00', 10, '{1,2,3,4,5}');

-- ------------------------------------------------------------ employees
-- Name and email live on users (one source of truth). Salary lives in salary_profiles (migration 004).
-- Employees with history are never hard-deleted: deactivate instead (status + users.is_active).
CREATE TABLE employees (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code   text        NOT NULL CHECK (btrim(employee_code) <> ''),
  user_id         bigint      NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  phone           text,
  department_id   bigint      REFERENCES departments(id) ON DELETE RESTRICT,
  job_title       text,
  start_date      date        NOT NULL,
  employment_type text        NOT NULL DEFAULT 'full_time'
                  CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  shift_id        bigint      NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employees_code_key ON employees (lower(employee_code));
CREATE INDEX employees_department_idx ON employees (department_id);
CREATE INDEX employees_shift_idx      ON employees (shift_id);
CREATE INDEX employees_status_idx     ON employees (status);
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------- audit_logs
-- Append-only: UPDATE and DELETE are rejected by trigger (TRUNCATE is left for test cleanup).
CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id bigint      REFERENCES users(id) ON DELETE SET NULL,
  action        text        NOT NULL,            -- e.g. 'employee.update', 'payroll.approve'
  entity_type   text        NOT NULL,
  entity_id     text,
  reason        text,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_time_idx   ON audit_logs (occurred_at DESC);
CREATE INDEX audit_actor_idx  ON audit_logs (actor_user_id);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
