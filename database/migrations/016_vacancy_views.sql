-- Personal read receipts are independent of vacancy/application approval state.
CREATE TABLE vacancy_views (
 vacancy_id bigint NOT NULL REFERENCES internal_vacancies(id) ON DELETE CASCADE,
 employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 opened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(vacancy_id,employee_id)
);
CREATE INDEX vacancy_views_employee_idx ON vacancy_views(employee_id,vacancy_id);
