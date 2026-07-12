-- 0007_extraction.sql — the extracted spine (P1-6). Promises drive the open
-- promises tracker; the notes embedding is the semantic-search substrate.

CREATE TABLE IF NOT EXISTS promises (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text       text NOT NULL,
  owner      text NOT NULL,
  due_date   date,
  due_raw    text,
  confidence text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promises_user_id_idx ON promises(user_id);
CREATE INDEX IF NOT EXISTS promises_note_id_idx ON promises(note_id);

ALTER TABLE promises ENABLE ROW LEVEL SECURITY;
ALTER TABLE promises FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promises_tenant_isolation ON promises;
CREATE POLICY promises_tenant_isolation ON promises
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON promises TO tovira_app;

-- Semantic-search embedding for the raw note text (Titan/Cohere dim 1024).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding vector(1024);
