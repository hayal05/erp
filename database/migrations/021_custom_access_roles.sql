CREATE TABLE custom_access_roles (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
 activities text[] NOT NULL CHECK(cardinality(activities)>0),
 permissions text[] NOT NULL CHECK(cardinality(permissions)>0 AND NOT('access.manage'=ANY(permissions))),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by bigint NOT NULL REFERENCES users(id),updated_by bigint NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX custom_access_roles_name_key ON custom_access_roles(lower(btrim(name)));
CREATE TABLE custom_access_grants (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 role_id bigint NOT NULL REFERENCES custom_access_roles(id) ON DELETE RESTRICT,
 scope_type text NOT NULL CHECK(scope_type IN ('all','departments','employees')),
 department_ids bigint[] NOT NULL DEFAULT '{}',employee_ids bigint[] NOT NULL DEFAULT '{}',
 granted_by bigint NOT NULL REFERENCES users(id),granted_at timestamptz NOT NULL DEFAULT now(),
 revoked_by bigint REFERENCES users(id),revoked_at timestamptz,revoke_reason text,
 CHECK((scope_type='all' AND cardinality(department_ids)=0 AND cardinality(employee_ids)=0) OR
       (scope_type='departments' AND cardinality(department_ids)>0 AND cardinality(employee_ids)=0) OR
       (scope_type='employees' AND cardinality(employee_ids)>0 AND cardinality(department_ids)=0)),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR
       (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 3 AND 500))
);
CREATE UNIQUE INDEX custom_access_grants_active_key ON custom_access_grants(user_id,role_id) WHERE revoked_at IS NULL;
CREATE INDEX custom_access_grants_user_idx ON custom_access_grants(user_id,revoked_at);
CREATE FUNCTION protect_custom_access_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Custom access history cannot be deleted'; END IF;
 IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR
  ROW(NEW.id,NEW.user_id,NEW.role_id,NEW.scope_type,NEW.department_ids,NEW.employee_ids,NEW.granted_by,NEW.granted_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.role_id,OLD.scope_type,OLD.department_ids,OLD.employee_ids,OLD.granted_by,OLD.granted_at)
 THEN RAISE EXCEPTION 'Custom access can only be revoked once'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER custom_access_grants_guard BEFORE UPDATE OR DELETE ON custom_access_grants FOR EACH ROW EXECUTE FUNCTION protect_custom_access_grant();
