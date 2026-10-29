ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
-- Existing employee credentials were issued by HR before temporary passwords were tracked.
UPDATE users SET must_change_password=true WHERE role='employee';
