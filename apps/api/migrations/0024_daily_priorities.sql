-- 0024_daily_priorities.sql — cost-guard #3 (P4b-3): the precomputed daily
-- priorities cache. One row per rep per day; app-opens read it instead of
-- recomputing (a model call every open). Tenant-scoped with RLS.
CREATE TABLE IF NOT EXISTS daily_priorities (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day           date NOT NULL,
  actions       jsonb NOT NULL,
  refresh_count int NOT NULL DEFAULT 0,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE daily_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_priorities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_priorities_tenant_isolation ON daily_priorities;
CREATE POLICY daily_priorities_tenant_isolation ON daily_priorities
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_priorities TO tovira_app;
