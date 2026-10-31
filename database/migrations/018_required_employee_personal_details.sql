-- User-supplied corrections for the two existing employees. Migration runs once.
-- Match employee ID/code or login username, case-insensitively; refuse ambiguity.
-- Fresh installations have neither identifier and require no backfill.
DO $$
DECLARE
  person record;
  matches bigint[];
BEGIN
  FOR person IN SELECT * FROM (VALUES
    ('xyz', 'male', DATE '1995-11-05', 'Accounting'),
    ('er5', 'female', DATE '2000-10-21', 'Management')
  ) AS supplied(identifier, gender, date_of_birth, field_of_study)
  LOOP
    SELECT array_agg(e.id) INTO matches
    FROM employees e JOIN users u ON u.id=e.user_id
    WHERE lower(e.employee_code)=person.identifier OR lower(u.username)=person.identifier;
    IF cardinality(matches)>1 THEN
      RAISE EXCEPTION 'Employee personal-detail backfill: identifier % matches multiple employees', person.identifier;
    END IF;
    IF cardinality(matches)=1 THEN
      UPDATE employees SET gender=person.gender, date_of_birth=person.date_of_birth,
        field_of_study=person.field_of_study WHERE id=matches[1];
    END IF;
  END LOOP;
END $$;
-- Required fields are enforced by registration and effective-record validation on
-- administrative edits. Keep legacy nullable columns so an unrelated incomplete
-- imported record does not prevent startup; HR must complete it before editing.
