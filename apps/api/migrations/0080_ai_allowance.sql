-- 0080_ai_allowance.sql — [USAGE-ALLOWANCE] the monthly AI-allowance ledger (Task 2).
--
-- Per-account, per-monthly-window usage with an atomic reservation protocol, plus a global
-- calendar-month spend record used ONLY for an email alert (never a wall). AED, numeric(16,8) so tiny
-- per-call costs (a fraction of a fil) accumulate without rounding drift.

-- The per-account monthly window: allowance (resets monthly) + carried/purchased top-up + settled spent
-- + in-flight reserved. Available this window = allowance_aed + topup_aed.
CREATE TABLE IF NOT EXISTS ai_usage_month (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key      text NOT NULL,                 -- allowanceWindow() key, e.g. 'm:2026-10' / 'trial:<ts>'
  period_start_ms bigint NOT NULL,               -- window start (orders windows for top-up carry-forward)
  allowance_aed   numeric(16,8) NOT NULL,
  topup_aed       numeric(16,8) NOT NULL DEFAULT 0,
  spent_aed       numeric(16,8) NOT NULL DEFAULT 0,
  reserved_aed    numeric(16,8) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_key),
  CONSTRAINT ai_usage_month_nonneg CHECK (allowance_aed >= 0 AND topup_aed >= 0 AND spent_aed >= 0 AND reserved_aed >= 0)
);
CREATE INDEX IF NOT EXISTS ai_usage_month_user_start_idx ON ai_usage_month(user_id, period_start_ms);

ALTER TABLE ai_usage_month ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_month FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_month_tenant_isolation ON ai_usage_month;
CREATE POLICY ai_usage_month_tenant_isolation ON ai_usage_month
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_month TO tovira_app;

-- Each outstanding reservation, so a crashed mid-call can be expired and its estimate freed.
CREATE TABLE IF NOT EXISTS ai_reservation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key   text NOT NULL,
  estimate_aed numeric(16,8) NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'released', 'expired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_reservation_sweep_idx ON ai_reservation(status, expires_at);
CREATE INDEX IF NOT EXISTS ai_reservation_user_idx ON ai_reservation(user_id, period_key);

ALTER TABLE ai_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_reservation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_reservation_tenant_isolation ON ai_reservation;
CREATE POLICY ai_reservation_tenant_isolation ON ai_reservation
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_reservation TO tovira_app;

-- The GLOBAL calendar-month spend total, for the email alert ONLY (D13 blocking removed). Not
-- tenant-scoped: one row per 'YYYY-MM' across all accounts. Written on the superuser connection by the
-- settle path and the stale-reservation sweep, so it carries NO RLS.
CREATE TABLE IF NOT EXISTS ai_global_month (
  ym         text PRIMARY KEY,                  -- 'YYYY-MM' calendar month
  spent_aed  numeric(16,8) NOT NULL DEFAULT 0,
  alert_sent boolean NOT NULL DEFAULT false,    -- the alert email fires exactly once per month
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON ai_global_month TO tovira_app;
