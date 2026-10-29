CREATE TABLE change_requests (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 requester_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 department text NOT NULL CHECK(department IN ('hr','finance')),
 permission text NOT NULL,
 method text NOT NULL CHECK(method IN ('POST','PUT','PATCH','DELETE')),
 path text NOT NULL,
 payload_cipher text,
 payload_preview jsonb NOT NULL,
 fingerprint text NOT NULL,
 dedupe_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 reviewer_id bigint REFERENCES users(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,
 review_reason text,
 CHECK((status='pending' AND payload_cipher IS NOT NULL AND reviewer_id IS NULL AND reviewed_at IS NULL) OR
       (status<>'pending' AND payload_cipher IS NULL AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)),
 CHECK(status<>'approved' OR (reviewer_id IS NOT NULL AND reviewer_id<>requester_id AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX change_requests_pending_key ON change_requests(requester_id,dedupe_key) WHERE status='pending';
CREATE INDEX change_requests_inbox_idx ON change_requests(department,status,id DESC);

-- Requests are immutable proposals. Only one pending -> final transition is allowed.
CREATE FUNCTION protect_change_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Change request history cannot be deleted';
 END IF;
 IF OLD.status<>'pending' OR NEW.status='pending' OR
   ROW(NEW.id,NEW.requester_id,NEW.department,NEW.permission,NEW.method,NEW.path,NEW.payload_preview,NEW.fingerprint,NEW.dedupe_key,NEW.requested_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.requester_id,OLD.department,OLD.permission,OLD.method,OLD.path,OLD.payload_preview,OLD.fingerprint,OLD.dedupe_key,OLD.requested_at) THEN
  RAISE EXCEPTION 'Change request proposals and final decisions are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER change_requests_immutable BEFORE UPDATE OR DELETE ON change_requests
 FOR EACH ROW EXECUTE FUNCTION protect_change_request();
