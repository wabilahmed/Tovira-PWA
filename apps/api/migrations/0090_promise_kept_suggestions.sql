-- 0090_promise_kept_suggestions.sql — [P24-2] "Looks like you sent it — mark done?" suggestions.
--
-- A delivery the promise's owner states later in a chat NEVER closes the promise: it becomes one of these,
-- answered by the rep (Mark done → accepted / Not yet → dismissed). Identity is (client, promise key,
-- delivery message time): the promise KEY (owner + normalised text — the facts dedupe identity) rather than
-- a promise row id, because re-extracting a note recreates its promise rows, and a "Not yet" on a delivery
-- message must survive a re-import while a NEW delivery message can suggest again (the UNIQUE below).
-- Receipts are verbatim spans + message times (no message rows to FK to). RLS-scoped like every tenant table.
CREATE TABLE IF NOT EXISTS promise_kept_suggestions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note_id       uuid REFERENCES notes(id) ON DELETE SET NULL,
  promise_key   text NOT NULL,
  promise_owner text NOT NULL CHECK (promise_owner IN ('rep', 'client')),
  promise_text  text NOT NULL,
  promise_span  text,
  promise_at    text,
  delivery_at   text NOT NULL,
  delivery_body text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'accepted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  UNIQUE (user_id, client_id, promise_key, delivery_at)
);
CREATE INDEX IF NOT EXISTS promise_kept_suggestions_open_idx ON promise_kept_suggestions (user_id) WHERE status = 'open';

ALTER TABLE promise_kept_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promise_kept_suggestions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promise_kept_suggestions_tenant_isolation ON promise_kept_suggestions;
CREATE POLICY promise_kept_suggestions_tenant_isolation ON promise_kept_suggestions
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON promise_kept_suggestions TO tovira_app;

-- Rollback (manual): drop the promise_kept_suggestions table.
