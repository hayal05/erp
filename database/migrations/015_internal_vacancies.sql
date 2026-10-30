CREATE TABLE internal_vacancies (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 department_id bigint NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
 position_id bigint NOT NULL,
 description text NOT NULL DEFAULT '' CHECK(length(description)<=5000),
 closing_on date NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','open','closed')),
 published_at timestamptz,
 created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 FOREIGN KEY(department_id,position_id) REFERENCES positions(department_id,id) ON DELETE RESTRICT,
 CHECK(status<>'open' OR published_at IS NOT NULL)
);
CREATE INDEX internal_vacancies_feed_idx ON internal_vacancies(status,closing_on,id DESC);
CREATE TRIGGER internal_vacancies_updated_at BEFORE UPDATE ON internal_vacancies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE vacancy_applications (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vacancy_id bigint NOT NULL REFERENCES internal_vacancies(id) ON DELETE RESTRICT,
 employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 profile_snapshot jsonb NOT NULL CHECK(jsonb_typeof(profile_snapshot)='object'),
 applied_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','shortlisted','selected','rejected')),
 reviewed_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(vacancy_id,employee_id),
 CHECK((status='applied' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
  OR(status<>'applied' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX vacancy_applications_employee_idx ON vacancy_applications(employee_id,applied_at DESC,id DESC);
CREATE INDEX vacancy_applications_review_idx ON vacancy_applications(vacancy_id,applied_at DESC,id DESC);
CREATE FUNCTION protect_vacancy_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.vacancy_id IS DISTINCT FROM OLD.vacancy_id
 OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.profile_snapshot IS DISTINCT FROM OLD.profile_snapshot
 OR NEW.applied_at IS DISTINCT FROM OLD.applied_at THEN RAISE EXCEPTION 'Application identity and profile snapshot cannot be changed'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vacancy_application_snapshot BEFORE UPDATE ON vacancy_applications FOR EACH ROW EXECUTE FUNCTION protect_vacancy_application();
