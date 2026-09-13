-- 0063_import_acknowledgements.sql [PRIVACY-5] — the first-import acknowledgement, once per account.
-- Before the FIRST chat-export upload, the rep acknowledges they have the right to upload messages
-- written by other people. Recorded once per account (user_id is the PK) with a timestamp, server-side
-- so it survives logout, RLS-scoped like every tenant table, and purged on account deletion via the
-- users FK cascade. First write wins (the app inserts ON CONFLICT DO NOTHING), so the timestamp is the
-- moment of first agreement.

CREATE TABLE IF NOT EXISTS import_acknowledgements (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE import_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_acknowledgements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_acknowledgements_tenant_isolation ON import_acknowledgements;
CREATE POLICY import_acknowledgements_tenant_isolation ON import_acknowledgements
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON import_acknowledgements TO tovira_app;
