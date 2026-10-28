-- 004_payroll: settings, income tax brackets, other taxes, flat deductions, salary profiles, payroll periods/entries.
-- Decisions (documented in plan/project status.md):
--   * ALL money is integer MINOR units (bigint; 1 ETB = 100 cents), never floating point. Rates are numeric percentages (0-100).
--   * Nothing here assumes statutory rules: no brackets, no other taxes and no deductions are seeded. HR enters them.
--   * Settings and profiles are editable at any time but only affect DRAFT payrolls. Approval copies the settings into the
--     period (config_snapshot) and the amounts into payroll_entries, and the triggers below then lock that data, so later
--     configuration changes can never rewrite history (spec 26 #16, #17).

-- ------------------------------------------------------- payroll_settings
-- Exactly one row (id is always true). tax_base / pension_base choose what the percentages apply to (spec 13, 14).
-- Rates are percentages; the defaults are the spec's (employee 5%, company 10%).
CREATE TABLE payroll_settings (
  id                            boolean PRIMARY KEY DEFAULT true CHECK (id),
  currency_code                 text          NOT NULL DEFAULT 'ETB' CHECK (currency_code ~ '^[A-Z]{3}$'),
  tax_base                      text          NOT NULL DEFAULT 'basic' CHECK (tax_base IN ('basic', 'basic_plus_taxable_allowance')),
  pension_base                  text          NOT NULL DEFAULT 'basic' CHECK (pension_base IN ('basic', 'basic_plus_pensionable_allowance')),
  employee_pension_rate         numeric(7, 4) NOT NULL DEFAULT 5  CHECK (employee_pension_rate BETWEEN 0 AND 100),
  company_pension_rate          numeric(7, 4) NOT NULL DEFAULT 10 CHECK (company_pension_rate BETWEEN 0 AND 100),
  rounding_mode                 text          NOT NULL DEFAULT 'half_up' CHECK (rounding_mode IN ('half_up', 'half_even', 'down', 'up')),
  absence_deduction_enabled     boolean       NOT NULL DEFAULT false,
  unpaid_leave_deduction_enabled boolean      NOT NULL DEFAULT false,
  updated_at                    timestamptz   NOT NULL DEFAULT now()
);
INSERT INTO payroll_settings (id) VALUES (true);
CREATE TRIGGER payroll_settings_updated_at BEFORE UPDATE ON payroll_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------ income_tax_brackets
-- Tax = MAX(0, taxable income x rate / 100 - fixed deduction) (spec 13). A bracket applies when from <= income < to
-- (to_minor is EXCLUSIVE; NULL = no upper limit). The database only guarantees "no overlap" and ordered bounds; gaps and a
-- missing open-ended bracket are validated by the API (task 4.5), which also blocks calculation/approval while invalid.
CREATE TABLE income_tax_brackets (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_minor            bigint        NOT NULL CHECK (from_minor >= 0),
  to_minor              bigint        CHECK (to_minor IS NULL OR to_minor > from_minor),
  rate                  numeric(7, 4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  fixed_deduction_minor bigint        NOT NULL DEFAULT 0 CHECK (fixed_deduction_minor >= 0),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT income_tax_brackets_no_overlap EXCLUDE USING gist ((int8range(from_minor, to_minor, '[)')) WITH &&)
);
CREATE TRIGGER income_tax_brackets_updated_at BEFORE UPDATE ON income_tax_brackets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------ other_taxes
-- Tax = base x rate / 100, summed into the "Other Tax" column (spec 15). The base is chosen from a fixed list, never a formula.
CREATE TABLE other_taxes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text          NOT NULL CHECK (btrim(name) <> ''),
  rate       numeric(7, 4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  base       text          NOT NULL CHECK (base IN ('gross', 'basic', 'taxable_income', 'pensionable')),
  enabled    boolean       NOT NULL DEFAULT true,
  created_at timestamptz   NOT NULL DEFAULT now(),
  updated_at timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX other_taxes_name_key ON other_taxes (lower(name));
CREATE TRIGGER other_taxes_updated_at BEFORE UPDATE ON other_taxes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------ salary_profiles
-- One per employee (spec 9): basic salary and ONE allowance amount. The two flags say whether the allowance counts toward
-- taxable income / the pensionable base when the settings choose "basic plus allowance". pension_applies is the per-employee
-- switch from spec 14. Changing a profile affects draft payrolls only.
CREATE TABLE salary_profiles (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id            bigint      NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  basic_minor            bigint      NOT NULL DEFAULT 0 CHECK (basic_minor BETWEEN 0 AND 9999999999999),
  allowance_minor        bigint      NOT NULL DEFAULT 0 CHECK (allowance_minor BETWEEN 0 AND 9999999999999),
  allowance_taxable      boolean     NOT NULL DEFAULT true,
  allowance_pensionable  boolean     NOT NULL DEFAULT true,
  pension_applies        boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salary_profiles_employee_key UNIQUE (employee_id)
);
CREATE TRIGGER salary_profiles_updated_at BEFORE UPDATE ON salary_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------ payroll_periods
-- One per calendar month (period_month is always the 1st). draft -> approved -> paid. config_snapshot is the settings,
-- brackets and other taxes as they were at approval (written once, then locked by the trigger below).
CREATE TABLE payroll_periods (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_month        date        NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  status              text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  config_snapshot     jsonb,
  approved_at         timestamptz,
  approved_by_user_id bigint      REFERENCES users(id) ON DELETE RESTRICT,
  paid_on             date,
  paid_by_user_id     bigint      REFERENCES users(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_periods_month_key UNIQUE (period_month),
  CONSTRAINT payroll_periods_draft_is_open CHECK ((status = 'draft') = (approved_at IS NULL)),
  CONSTRAINT payroll_periods_approved_complete CHECK (status = 'draft' OR (config_snapshot IS NOT NULL AND approved_by_user_id IS NOT NULL)),
  CONSTRAINT payroll_periods_paid_complete CHECK ((status = 'paid') = (paid_on IS NOT NULL AND paid_by_user_id IS NOT NULL))
);
CREATE TRIGGER payroll_periods_updated_at BEFORE UPDATE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------- deduction_items
-- Flat amounts per employee (spec 16): advance, loan, penalty, other. A recurring item applies to every payroll while enabled.
-- A one-time item applies to exactly one payroll: applied_period_id is set when that payroll is generated and cleared again if
-- the (draft) period is deleted, so it is never applied twice.
CREATE TABLE deduction_items (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id       bigint      NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  kind              text        NOT NULL CHECK (kind IN ('advance', 'loan', 'penalty', 'other')),
  name              text        NOT NULL CHECK (btrim(name) <> ''),
  amount_minor      bigint      NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 9999999999999),
  recurring         boolean     NOT NULL DEFAULT false,
  enabled           boolean     NOT NULL DEFAULT true,
  applied_period_id bigint      REFERENCES payroll_periods(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deduction_items_recurring_never_consumed CHECK (NOT recurring OR applied_period_id IS NULL)
);
CREATE INDEX deduction_items_employee_idx ON deduction_items (employee_id);
CREATE TRIGGER deduction_items_updated_at BEFORE UPDATE ON deduction_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------- payroll_entries
-- One row per employee per period. Every amount and the rates/brackets used are stored here, so an approved payroll can be
-- shown and printed without looking at any current setting. The CHECKs repeat the spec 17 formulas as a database backstop.
CREATE TABLE payroll_entries (
  id                               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id                        bigint        NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id                      bigint        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  employee_code                    text          NOT NULL,
  employee_name                    text          NOT NULL,
  basic_minor                      bigint        NOT NULL CHECK (basic_minor >= 0),
  allowance_minor                  bigint        NOT NULL CHECK (allowance_minor >= 0),
  gross_minor                      bigint        NOT NULL,
  taxable_income_minor             bigint        NOT NULL CHECK (taxable_income_minor >= 0),
  income_tax_rate                  numeric(7, 4) NOT NULL,
  income_tax_fixed_deduction_minor bigint        NOT NULL,
  income_tax_minor                 bigint        NOT NULL CHECK (income_tax_minor >= 0),
  other_tax_minor                  bigint        NOT NULL CHECK (other_tax_minor >= 0),
  pensionable_minor                bigint        NOT NULL CHECK (pensionable_minor >= 0),
  employee_pension_rate            numeric(7, 4) NOT NULL,
  employee_pension_minor           bigint        NOT NULL CHECK (employee_pension_minor >= 0),
  employer_pension_rate            numeric(7, 4) NOT NULL,
  employer_pension_minor           bigint        NOT NULL CHECK (employer_pension_minor >= 0),
  other_deductions_minor           bigint        NOT NULL CHECK (other_deductions_minor >= 0),
  net_minor                        bigint        NOT NULL,
  employer_cost_minor              bigint        NOT NULL,
  created_at                       timestamptz   NOT NULL DEFAULT now(),
  updated_at                       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT payroll_entries_period_employee_key UNIQUE (period_id, employee_id),
  CONSTRAINT payroll_entries_gross CHECK (gross_minor = basic_minor + allowance_minor),
  CONSTRAINT payroll_entries_net CHECK (net_minor = gross_minor - income_tax_minor - other_tax_minor - employee_pension_minor - other_deductions_minor),
  CONSTRAINT payroll_entries_employer_cost CHECK (employer_cost_minor = gross_minor + employer_pension_minor)
);
CREATE INDEX payroll_entries_employee_idx ON payroll_entries (employee_id);
CREATE TRIGGER payroll_entries_updated_at BEFORE UPDATE ON payroll_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------- payroll_entry_items
-- The breakdown behind "Other Tax" and "Other Deductions" (row detail panel and payslip). Labels, rates and bases are copied,
-- and source_id is a plain number (no foreign key), so deleting or renaming a setting never touches an approved payroll.
-- kind 'absence' / 'unpaid_leave' are the attendance-driven deductions (task 4.15).
CREATE TABLE payroll_entry_items (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id     bigint        NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
  kind         text          NOT NULL CHECK (kind IN ('other_tax', 'advance', 'loan', 'penalty', 'other', 'absence', 'unpaid_leave')),
  label        text          NOT NULL CHECK (btrim(label) <> ''),
  rate         numeric(7, 4),
  base_minor   bigint,
  amount_minor bigint        NOT NULL CHECK (amount_minor >= 0),
  source_id    bigint,
  CONSTRAINT payroll_entry_items_tax_has_rate CHECK (kind <> 'other_tax' OR (rate IS NOT NULL AND base_minor IS NOT NULL))
);
CREATE INDEX payroll_entry_items_entry_idx ON payroll_entry_items (entry_id);

-- ------------------------------------------------------------ immutability
-- Once a period is approved: no entry or item can be added, changed or removed, the period cannot be deleted, and the only
-- change the period itself accepts is approved -> paid (paid_on / paid_by). Triggers do not fire on TRUNCATE (test cleanup).
CREATE FUNCTION payroll_period_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'An approved or paid payroll period cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'paid'
     AND NEW.period_month = OLD.period_month AND NEW.config_snapshot IS NOT DISTINCT FROM OLD.config_snapshot
     AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at AND NEW.approved_by_user_id IS NOT DISTINCT FROM OLD.approved_by_user_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An approved or paid payroll period is locked';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_periods_guard BEFORE UPDATE OR DELETE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION payroll_period_guard();

CREATE FUNCTION payroll_entry_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO st FROM payroll_periods WHERE id = OLD.period_id;
    IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'Entries of an approved or paid payroll period are locked'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO st FROM payroll_periods WHERE id = NEW.period_id;
    IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'Entries of an approved or paid payroll period are locked'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_entries FOR EACH ROW EXECUTE FUNCTION payroll_entry_guard();

CREATE FUNCTION payroll_item_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT p.status INTO st FROM payroll_entries e JOIN payroll_periods p ON p.id = e.period_id WHERE e.id = OLD.entry_id;
    IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'Items of an approved or paid payroll period are locked'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT p.status INTO st FROM payroll_entries e JOIN payroll_periods p ON p.id = e.period_id WHERE e.id = NEW.entry_id;
    IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'Items of an approved or paid payroll period are locked'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_entry_items_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_entry_items FOR EACH ROW EXECUTE FUNCTION payroll_item_guard();
