-- [SPEND-CAP] Durable per-account, per-billing-period Claude spend. One row per
-- (rep, billing period, cost class); spend accumulates. Buckets by the rep's billing
-- window (period_key) so the cap and the invoice describe the same window. Embeddings
-- and transcription are NOT Claude spend and are never written here.
CREATE TABLE IF NOT EXISTS spend_ledger (
  user_id    text NOT NULL,
  period_key text NOT NULL,
  cost_class text NOT NULL,
  aed        double precision NOT NULL DEFAULT 0,
  calls      integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_key, cost_class)
);

-- Tenant isolation at the DB (Postgres RLS), not just in app code — a rep sees only their own rows.
ALTER TABLE spend_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE spend_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY spend_ledger_tenant ON spend_ledger
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

GRANT SELECT, INSERT, UPDATE ON spend_ledger TO tovira_app;

-- The cross-tenant distribution read (/health + ops) runs on the SUPERUSER pool, RLS-bypassing.
CREATE INDEX IF NOT EXISTS spend_ledger_period_idx ON spend_ledger (period_key);
