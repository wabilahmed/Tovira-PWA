-- 0027_push_budget.sql — the silence budget (max 2 pushes/rep/day). A SYSTEM
-- table (the daily scan runs with no user session), so no RLS; access filters
-- by user_id explicitly. Counts ALERTS sent per rep per UTC day, not device
-- fan-out — the cap protects the rep's attention, not the wire.
CREATE TABLE IF NOT EXISTS push_budget (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date NOT NULL,
  sent    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON push_budget TO tovira_app;
