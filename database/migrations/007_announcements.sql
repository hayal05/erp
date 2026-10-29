-- Text-only notices: loaded on demand, no background jobs or file storage.
CREATE TABLE announcements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  expires_on date,
  published_at timestamptz,
  created_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX announcements_feed_idx ON announcements(published_at DESC, id DESC) WHERE status='published';
CREATE INDEX announcements_admin_idx ON announcements(updated_at DESC,id DESC);
CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON announcements
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
