-- 0058_contact_aliases.sql [ALIAS] — learned WhatsApp contact aliases per client, and the rep's own
-- WhatsApp display name. A rep's contact is almost never saved under the client's real name (a
-- nickname, a company, Arabic script); the alias, learned once on a confirmed import, stops the
-- misfile detector crying wolf on every future import from that contact.

-- Per-client aliases. Mirrors the requirements child-table pattern (0048): composite (user_id,
-- client_id) FK to clients, cascade on client delete, RLS by app.user_id. Purged with the account
-- by the users→clients cascade.
CREATE TABLE IF NOT EXISTS client_aliases (
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  client_id  uuid NOT NULL,
  alias      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT client_aliases_user_client_fk FOREIGN KEY (user_id, client_id) REFERENCES clients (user_id, id) ON DELETE CASCADE,
  CONSTRAINT client_aliases_unique UNIQUE (user_id, client_id, alias)
);
CREATE INDEX IF NOT EXISTS client_aliases_user_client_idx ON client_aliases (user_id, client_id);
ALTER TABLE client_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY client_aliases_tenant ON client_aliases
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, DELETE ON client_aliases TO tovira_app;

-- The rep's own WhatsApp display name — one row per rep, learned from their first import (the
-- speaker who is not the client) or set in Settings. Used to identify the counterpart by elimination.
CREATE TABLE IF NOT EXISTS rep_names (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  whatsapp_name text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rep_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE rep_names FORCE ROW LEVEL SECURITY;
CREATE POLICY rep_names_tenant ON rep_names
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON rep_names TO tovira_app;
