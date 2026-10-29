-- A shared row serializes changes that could remove the last usable Admin.
CREATE TABLE access_safeguard_lock (singleton boolean PRIMARY KEY CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO access_safeguard_lock(singleton) VALUES(true);
CREATE FUNCTION usable_admin_exists(excluded_user bigint, excluded_grant bigint) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM access_grants g JOIN users u ON u.id=g.user_id
 WHERE g.access_role='admin' AND g.revoked_at IS NULL AND u.is_active
 AND (excluded_user IS NULL OR u.id<>excluded_user) AND (excluded_grant IS NULL OR g.id<>excluded_grant)
 AND (u.role='hr' OR EXISTS(SELECT 1 FROM employees e WHERE e.user_id=u.id AND e.status='active')))
$$;
CREATE FUNCTION protect_admin_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.access_role='admin' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
  UPDATE access_safeguard_lock SET revision=revision+1 WHERE singleton;
  IF EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND is_active)
    AND NOT usable_admin_exists(NULL,OLD.id) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Cannot revoke the last active Admin',CONSTRAINT='last_active_admin';
  END IF;
 END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER access_grants_last_admin BEFORE UPDATE ON access_grants FOR EACH ROW EXECUTE FUNCTION protect_admin_grant();
CREATE FUNCTION protect_admin_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target bigint; removing boolean;
BEGIN
 IF TG_TABLE_NAME='users' THEN target=OLD.id; removing=OLD.is_active AND NOT NEW.is_active;
 ELSE target=OLD.user_id; removing=OLD.status='active' AND NEW.status<>'active'; END IF;
 IF removing THEN
  UPDATE access_safeguard_lock SET revision=revision+1 WHERE singleton;
  IF EXISTS(SELECT 1 FROM access_grants g JOIN users u ON u.id=g.user_id
      WHERE g.user_id=target AND g.access_role='admin' AND g.revoked_at IS NULL AND u.is_active)
    AND NOT usable_admin_exists(target,NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Cannot deactivate the last active Admin',CONSTRAINT='last_active_admin';
  END IF;
 END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER users_last_admin BEFORE UPDATE OF is_active ON users FOR EACH ROW EXECUTE FUNCTION protect_admin_account();
CREATE TRIGGER employees_last_admin BEFORE UPDATE OF status ON employees FOR EACH ROW EXECUTE FUNCTION protect_admin_account();
