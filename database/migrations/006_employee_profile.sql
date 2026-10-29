-- Personal experience is employee-maintained; employment facts remain HR-managed.
ALTER TABLE employees ADD COLUMN experience_summary text NOT NULL DEFAULT '' CHECK (length(experience_summary) <= 5000);
CREATE TABLE employee_position_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_name text,
  position_name text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  is_baseline boolean NOT NULL DEFAULT false
);
CREATE INDEX employee_position_history_employee_idx ON employee_position_history(employee_id, recorded_at DESC, id DESC);
-- Preserve names even when departments/positions are later renamed or removed.
INSERT INTO employee_position_history(employee_id, department_name, position_name, is_baseline)
SELECT e.id, d.name, COALESCE(p.name,e.job_title), true FROM employees e
LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id;
CREATE FUNCTION record_employee_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.department_id IS NOT DISTINCT FROM OLD.department_id
       AND NEW.position_id IS NOT DISTINCT FROM OLD.position_id
       AND NEW.job_title IS NOT DISTINCT FROM OLD.job_title THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO employee_position_history(employee_id,department_name,position_name)
  VALUES(NEW.id,(SELECT name FROM departments WHERE id=NEW.department_id),
    COALESCE((SELECT name FROM positions WHERE id=NEW.position_id),NEW.job_title));
  RETURN NEW;
END;
$$;
CREATE TRIGGER employees_position_history AFTER INSERT OR UPDATE OF department_id,position_id,job_title ON employees
FOR EACH ROW EXECUTE FUNCTION record_employee_position();
