-- 0016_images.sql — per-client gallery images (P4-6). RLS.
CREATE TABLE IF NOT EXISTS images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  storage_key  text NOT NULL,
  content_type text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_client_id_idx ON images(client_id);

ALTER TABLE images ENABLE ROW LEVEL SECURITY;
ALTER TABLE images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS images_tenant_isolation ON images;
CREATE POLICY images_tenant_isolation ON images
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON images TO tovira_app;
