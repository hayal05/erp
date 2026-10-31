-- Optional for existing employees; HR/Admin can supply or update these details later.
ALTER TABLE employees
  ADD COLUMN gender text CHECK (gender IN ('male', 'female')),
  ADD COLUMN date_of_birth date CHECK (date_of_birth >= DATE '0001-01-01'),
  ADD COLUMN field_of_study text CHECK (length(btrim(field_of_study)) BETWEEN 1 AND 150);
