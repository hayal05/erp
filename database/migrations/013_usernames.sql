-- Login identity is independent of optional contact email.
ALTER TABLE users ADD COLUMN username text;
UPDATE users SET username=lower(email);
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
DROP INDEX users_email_key;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_username_valid CHECK(username=btrim(username) AND length(username) BETWEEN 3 AND 254);
CREATE UNIQUE INDEX users_username_key ON users(lower(username));
-- Keep legacy SQL inserts/rolling-deploy clients usable; the employee API requires
-- an explicit username. Contact edits never change an existing username.
CREATE FUNCTION normalize_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.username IS NULL THEN NEW.username=NEW.email; END IF;
 NEW.username=lower(btrim(NEW.username));
 NEW.email=NULLIF(lower(btrim(NEW.email)),'');
 RETURN NEW;
END;
$$;
CREATE TRIGGER users_identity BEFORE INSERT OR UPDATE OF username,email ON users
 FOR EACH ROW EXECUTE FUNCTION normalize_user_identity();
