-- Reporting policy only: never changes employment status or payroll.
CREATE TABLE retirement_settings (
 id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
 retirement_age integer CHECK (retirement_age BETWEEN 18 AND 100),
 version integer NOT NULL DEFAULT 1 CHECK (version>0)
);
INSERT INTO retirement_settings(id) VALUES(1);
