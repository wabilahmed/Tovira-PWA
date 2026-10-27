-- 0102_going_quiet_alerts.sql — [P47-2] When a going-quiet alert for a client REACHED the rep (the Today card shown, or
-- a delivered push), for the Ledger's "Clients Tovira helped you win back". An alert that was only generated is not
-- recorded here. One row per silence: quiet_since is the client's last activity when the alert reached the rep, so a
-- client who goes quiet again (a new last activity) can be flagged, and won back, again.
-- Isolation as clients: RLS ENABLE + FORCE + tenant policy, composite FK (user_id, client_id) -> clients. Append-only
-- for the app role (SELECT + INSERT); rows go by cascade (a client or account deleted).
CREATE TABLE IF NOT EXISTS going_quiet_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL,
  quiet_since  timestamptz NOT NULL,
  silent_days  integer NOT NULL CHECK (silent_days >= 0),
  reached_at   timestamptz NOT NULL,
  reached_via  text NOT NULL CHECK (reached_via IN ('today', 'push')),
  CONSTRAINT going_quiet_alerts_one_per_silence UNIQUE (user_id, client_id, quiet_since),
  CONSTRAINT going_quiet_alerts_user_id_client_id_fkey
    FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS going_quiet_alerts_user_id_idx ON going_quiet_alerts(user_id);

ALTER TABLE going_quiet_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE going_quiet_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS going_quiet_alerts_tenant_isolation ON going_quiet_alerts;
CREATE POLICY going_quiet_alerts_tenant_isolation ON going_quiet_alerts
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

GRANT SELECT, INSERT ON going_quiet_alerts TO tovira_app;
