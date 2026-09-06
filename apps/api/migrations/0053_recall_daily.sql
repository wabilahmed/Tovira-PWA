-- [SPEND-CAP] Per-rep, per-day recall count — consulted ONLY while a rep is over the spend cap, to
-- cap recall at N/day (stops a runaway loop in the hour). RLS tenant-scoped: a rep's own count.
CREATE TABLE IF NOT EXISTS recall_daily (
  user_id text NOT NULL,
  day     text NOT NULL, -- YYYY-MM-DD
  count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
ALTER TABLE recall_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY recall_daily_tenant ON recall_daily
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON recall_daily TO tovira_app;
