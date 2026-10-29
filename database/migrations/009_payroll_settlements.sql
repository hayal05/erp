-- Remittance records are separate from salary payments and never alter payroll history.
CREATE TABLE payroll_settlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('income_tax','pension')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 9999999999999),
  payment_date date NOT NULL,
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 120),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  request_id text NOT NULL UNIQUE,
  recorded_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_settlements_period_kind_idx ON payroll_settlements(period_id,kind,id DESC);
-- Serialize all payments against the parent period. Enforce the balance even for direct SQL writes.
CREATE FUNCTION guard_payroll_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; liability numeric; settled numeric;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Settlement records cannot be edited or deleted'; END IF;
  SELECT status INTO st FROM payroll_periods WHERE id=NEW.period_id FOR UPDATE;
  IF st IS DISTINCT FROM 'paid' THEN RAISE EXCEPTION 'Only paid payrolls can be settled'; END IF;
  SELECT COALESCE(sum(CASE WHEN NEW.kind='income_tax' THEN income_tax_minor
    ELSE employee_pension_minor + employer_pension_minor END),0) INTO liability
    FROM payroll_entries WHERE period_id=NEW.period_id;
  SELECT COALESCE(sum(amount_minor),0) INTO settled FROM payroll_settlements
    WHERE period_id=NEW.period_id AND kind=NEW.kind;
  IF settled + NEW.amount_minor > liability THEN RAISE EXCEPTION 'Settlement exceeds the remaining payable balance'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_settlements_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_settlements
FOR EACH ROW EXECUTE FUNCTION guard_payroll_settlement();
