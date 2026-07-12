-- 0010_corrections.sql — rep corrections as training data (P2-3). PII → RLS.
CREATE TABLE IF NOT EXISTS corrections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id      uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  field        text NOT NULL,
  before_value text,
  after_value  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corrections_user_id_idx ON corrections(user_id);

ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS corrections_tenant_isolation ON corrections;
CREATE POLICY corrections_tenant_isolation ON corrections
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON corrections TO tovira_app;
