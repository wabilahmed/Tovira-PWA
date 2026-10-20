-- 0092_product_tour.sql — [P37] the required first-login tour.
-- Completion lives on the ACCOUNT, not the browser: tour_completed_at + tour_version (the version completed), so
-- it never runs again on another phone or after clearing site data, and a new tour version can be required of
-- everyone. The step reached (tour_step, for its version tour_step_version) lets a reload or another device
-- resume at the same step; tour_max_step drives the anonymous funnel (a step counts once per rep).
-- Existing accounts get NULL completion → they see the tour once, on their next login.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tour_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tour_version integer,
  ADD COLUMN IF NOT EXISTS tour_step integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tour_max_step integer NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS tour_step_version integer;

-- The funnel: anonymous counts per (tour version, step, event) — where reps drop off. No user id, no personal
-- data, so nothing to tenant-scope (RLS-exempt, listed in rls-presence.test.ts). step is -1 for the
-- whole-tour events ('completed', 'import_tapped').
CREATE TABLE IF NOT EXISTS tour_funnel (
  tour_version integer NOT NULL,
  step         integer NOT NULL,
  event        text    NOT NULL CHECK (event IN ('reached', 'completed', 'import_tapped')),
  count        bigint  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tour_version, step, event)
);
GRANT SELECT, INSERT, UPDATE ON tour_funnel TO tovira_app;
