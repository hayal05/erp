-- 005_positions: job positions inside a department, each with a default salary package.
-- Additive only: one new table and one nullable column. No existing row is rewritten, so employees without a
-- position (everyone today) behave exactly as before.
--
-- A position's salary is a TEMPLATE. It uses the same five salary columns and limits as salary_profiles (004), so a
-- package copies straight into an employee's profile. The copy happens in the application, once, at assignment time;
-- nothing here links an employee's salary back to the position, so editing a position never changes anyone already on it.
-- Payroll tables are not touched.

CREATE TABLE positions (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id          bigint      NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name                   text        NOT NULL CHECK (btrim(name) <> ''),
  basic_minor            bigint      NOT NULL DEFAULT 0 CHECK (basic_minor BETWEEN 0 AND 9999999999999),
  allowance_minor        bigint      NOT NULL DEFAULT 0 CHECK (allowance_minor BETWEEN 0 AND 9999999999999),
  allowance_taxable      boolean     NOT NULL DEFAULT true,
  allowance_pensionable  boolean     NOT NULL DEFAULT true,
  pension_applies        boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- Target of the composite foreign key from employees (below).
  CONSTRAINT positions_department_id_id_key UNIQUE (department_id, id)
);
-- Same name allowed in different departments; case-insensitive within one.
CREATE UNIQUE INDEX positions_name_key ON positions (department_id, lower(name));
CREATE TRIGGER positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which position an employee holds. Nullable: employees may have no position (legacy job_title text stays as is).
-- The composite key makes the database itself refuse a position from another department; the CHECK closes the one
-- gap MATCH SIMPLE leaves (a position with no department). RESTRICT: a position in use cannot be deleted.
ALTER TABLE employees ADD COLUMN position_id bigint;
ALTER TABLE employees ADD CONSTRAINT employees_position_needs_department
  CHECK (position_id IS NULL OR department_id IS NOT NULL);
ALTER TABLE employees ADD CONSTRAINT employees_position_department_fkey
  FOREIGN KEY (department_id, position_id) REFERENCES positions (department_id, id) ON DELETE RESTRICT;
CREATE INDEX employees_position_idx ON employees (position_id);
