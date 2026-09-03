-- 0044_recall_sessions.sql — conversational Ask sessions (feat(ASK-SESSION)).
-- Ask becomes multi-turn: the last N messages are kept so pronouns/follow-ups resolve. Sessions
-- are the REP's own data (per rep, not per client), tenant-isolated at the DB (RLS + FORCE), and
-- cross-tenant references are composite-FK violations, not handler checks (IDOR fix at design time).
-- History is conversational continuity ONLY — never a source of truth; the vault is the memory.

CREATE TABLE IF NOT EXISTS recall_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  -- required for the composite FK from recall_messages (the tenant-isolation net).
  CONSTRAINT recall_sessions_user_id_id_key UNIQUE (user_id, id)
);
CREATE INDEX IF NOT EXISTS recall_sessions_user_activity_idx ON recall_sessions(user_id, last_activity_at DESC);

ALTER TABLE recall_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recall_sessions_tenant_isolation ON recall_sessions;
CREATE POLICY recall_sessions_tenant_isolation ON recall_sessions
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recall_sessions TO tovira_app;

CREATE TABLE IF NOT EXISTS recall_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  -- clock_timestamp() (not now()) so the user turn and the assistant turn of one request order
  -- deterministically within the same transaction.
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Cross-tenant references are DB errors, not handler checks (IDOR fix): the (user_id, session_id)
  -- pair must resolve within one tenant.
  CONSTRAINT recall_messages_user_id_session_id_fkey
    FOREIGN KEY (user_id, session_id) REFERENCES recall_sessions(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS recall_messages_session_idx ON recall_messages(user_id, session_id, created_at);

ALTER TABLE recall_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recall_messages_tenant_isolation ON recall_messages;
CREATE POLICY recall_messages_tenant_isolation ON recall_messages
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recall_messages TO tovira_app;
