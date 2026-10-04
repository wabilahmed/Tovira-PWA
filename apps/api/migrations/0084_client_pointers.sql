-- 0084_client_pointers.sql — [POINTERS] per-client relationship/closing pointers.
--
-- One row per client: the current pointer set (replaced wholesale on each extraction — keep/revise/
-- retire/add is decided upstream, D7) as jsonb, plus the exact retrospective disclosure when the set
-- holds a retrospective (D6). Receipts cite messages by verbatim span + timestamp (there are no message
-- rows to foreign-key to), so the only FK is to the client — ON DELETE CASCADE, and user_id → users
-- cascades on account deletion. RLS-scoped like every tenant table.
CREATE TABLE IF NOT EXISTS client_pointers (
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id                uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pointers                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  retrospective_disclosure text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

ALTER TABLE client_pointers ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pointers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_pointers_tenant_isolation ON client_pointers;
CREATE POLICY client_pointers_tenant_isolation ON client_pointers
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON client_pointers TO tovira_app;
