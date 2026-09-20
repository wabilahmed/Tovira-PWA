-- [TRIAL-FARM] Durable, monotonic per-account extraction counter, bucketed by billing period.
-- Replaces "count hot extraction_logs rows" (which archival / single-counterparty erasure could
-- LOWER) as the input to the trial + paid extraction ceilings. RLS tenant-scoped: a rep's own count.
--
-- Monotonicity is enforced at the privilege level: the app role is granted only SELECT/INSERT/UPDATE
-- (NO DELETE), so nothing in the app path can lower a count. Full account deletion still purges the
-- row via the users FK ON DELETE CASCADE (run as the table owner, so it needs no app DELETE grant).
CREATE TABLE IF NOT EXISTS extraction_counters (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key text NOT NULL, -- billing-period bucket (periodKeyFrom): t:<trialEnd> | p:<start> | pf:...
  count      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period_key)
);
ALTER TABLE extraction_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY extraction_counters_tenant ON extraction_counters
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
-- Deliberately NO DELETE grant: the counter only ever increments (archival/erasure cannot lower it).
GRANT SELECT, INSERT, UPDATE ON extraction_counters TO tovira_app;
