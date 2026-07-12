-- 0004_notes.sql — the "messy pile": raw captured text per client, plus the
-- extracted facts as JSONB (the flexible-notes layer from the spec). The spine
-- columns + pgvector embedding are added by Phase 1 (P1-5/P1-6). Tenant-scoped
-- with RLS, like every user table.

CREATE TABLE IF NOT EXISTS notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('voice', 'paste')),
  raw_text   text NOT NULL,
  extracted  jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_client_id_idx ON notes(client_id);
CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_tenant_isolation ON notes;
CREATE POLICY notes_tenant_isolation ON notes
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO tovira_app;
