-- 0103_client_rename.sql — [P49] A rep can rename a client.
--
-- 1. client_name_history: every rename (old name, new name, when), append-only. Nothing in the app shows it; it is the
--    record of what the client was called, so a renamed client can always be traced back to the name its chats carry.
--    Isolation as clients: RLS ENABLE + FORCE + tenant policy, composite FK (user_id, client_id) -> clients. SELECT +
--    INSERT only for the app role; rows go by cascade (a client or account deleted).
--
-- 2. client_aliases.kind: 'learned' (confirmed on an import, as before) or 'previous_name' (the name a rename replaced).
--    Both match the next imported chat and label its speakers. Only a learned alias folds an extracted person into the
--    client on a shared word; a previous name folds on the exact full name only (owner, P49), so renaming
--    "Khalid Dubai Marina" never folds a different "Marina" into the client. Existing rows are learned.

CREATE TABLE IF NOT EXISTS client_name_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL,
  old_name    text NOT NULL,
  new_name    text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_name_history_is_change_ck CHECK (old_name <> new_name),
  CONSTRAINT client_name_history_user_id_client_id_fkey
    FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS client_name_history_user_id_idx ON client_name_history(user_id);
CREATE INDEX IF NOT EXISTS client_name_history_client_id_changed_at_idx ON client_name_history(client_id, changed_at);

ALTER TABLE client_name_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_name_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_name_history_tenant_isolation ON client_name_history;
CREATE POLICY client_name_history_tenant_isolation ON client_name_history
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

GRANT SELECT, INSERT ON client_name_history TO tovira_app;

ALTER TABLE client_aliases ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'learned';
ALTER TABLE client_aliases DROP CONSTRAINT IF EXISTS client_aliases_kind_ck;
ALTER TABLE client_aliases ADD CONSTRAINT client_aliases_kind_ck CHECK (kind IN ('learned', 'previous_name'));
