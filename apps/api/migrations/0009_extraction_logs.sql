-- 0009_extraction_logs.sql — the extraction training log (P1-8). PII, so RLS.
CREATE TABLE IF NOT EXISTS extraction_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id        uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  prompt_version text NOT NULL,
  model          text NOT NULL,
  input          text NOT NULL,
  raw_output     text,
  status         text NOT NULL,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  latency_ms     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extraction_logs_user_id_idx ON extraction_logs(user_id);

ALTER TABLE extraction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS extraction_logs_tenant_isolation ON extraction_logs;
CREATE POLICY extraction_logs_tenant_isolation ON extraction_logs
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON extraction_logs TO tovira_app;
