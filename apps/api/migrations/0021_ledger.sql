-- 0021_ledger.sql — Recovered Value Ledger (P4-11). Records real value-touch
-- events + rep-entered deal values. Tenant-scoped with RLS. Deleting a client or
-- user cascades; the app also removes entries when their source event is deleted.
CREATE TABLE IF NOT EXISTS ledger_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type        text NOT NULL,
  source_id   text NOT NULL,
  dedupe_key  text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS ledger_events_user_id_idx ON ledger_events(user_id);

ALTER TABLE ledger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_events_tenant_isolation ON ledger_events;
CREATE POLICY ledger_events_tenant_isolation ON ledger_events
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ledger_events TO tovira_app;

CREATE TABLE IF NOT EXISTS client_deal_values (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  aed       numeric NOT NULL,
  PRIMARY KEY (user_id, client_id)
);

ALTER TABLE client_deal_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_deal_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_deal_values_tenant_isolation ON client_deal_values;
CREATE POLICY client_deal_values_tenant_isolation ON client_deal_values
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON client_deal_values TO tovira_app;
