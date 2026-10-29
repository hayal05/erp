-- Additional access never changes users.role or employee identity.
CREATE TABLE access_grants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  access_role text NOT NULL CHECK (access_role IN ('hr','finance','admin')),
  granted_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoke_reason text CHECK (length(revoke_reason) <= 500),
  CHECK ((revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) > 0)),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
CREATE UNIQUE INDEX access_grants_active_key ON access_grants(user_id,access_role) WHERE revoked_at IS NULL;
CREATE INDEX access_grants_history_idx ON access_grants(user_id,granted_at DESC,id DESC);
CREATE FUNCTION access_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Access grant history cannot be deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.access_role IS DISTINCT FROM OLD.access_role OR NEW.granted_by_user_id IS DISTINCT FROM OLD.granted_by_user_id
      OR NEW.granted_at IS DISTINCT FROM OLD.granted_at OR NEW.id IS DISTINCT FROM OLD.id OR NEW.revoked_at IS NULL
    THEN RAISE EXCEPTION 'Access grants can only be revoked once; issue a new grant to restore access'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER access_grants_guard BEFORE UPDATE OR DELETE ON access_grants FOR EACH ROW EXECUTE FUNCTION access_grant_guard();
CREATE FUNCTION audit_access_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,reason,details)
  VALUES(CASE WHEN TG_OP='INSERT' THEN NEW.granted_by_user_id ELSE NEW.revoked_by_user_id END,
    CASE WHEN TG_OP='INSERT' THEN 'access.grant' ELSE 'access.revoke' END,'access_grant',NEW.id,NEW.revoke_reason,
    jsonb_build_object('userId',NEW.user_id,'accessRole',NEW.access_role,'bootstrap',TG_OP='INSERT' AND NEW.granted_by_user_id IS NULL));
  RETURN NEW;
END;
$$;
CREATE TRIGGER access_grants_audit AFTER INSERT OR UPDATE ON access_grants FOR EACH ROW EXECUTE FUNCTION audit_access_grant();
-- Every existing hr account already had unrestricted administrative access. Preserve that access explicitly.
INSERT INTO access_grants(user_id,access_role) SELECT id,'admin' FROM users WHERE role='hr';
