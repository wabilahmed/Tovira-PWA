-- 0039_scheduled_job_runs.sql — SWEEP-NEVER-RUNS.
-- The scheduled "brain" (note sweep, nightly priorities, trial emails) is driven by
-- an in-process timer on the persistent API task, coordinated across tasks by a
-- Postgres session-scoped advisory lock. This table records the last run of each job
-- so liveness is checkable in /health: a scheduler that never fires otherwise looks
-- exactly like one with nothing to do — which is how the sweep silently not running
-- survived a deploy. A SYSTEM table (no RLS): the brain runs without a user session.
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_name    text PRIMARY KEY,
  last_run_at timestamptz NOT NULL,
  last_ok     boolean     NOT NULL,
  last_error  text
);

-- The API connects as the non-superuser role tovira_app (RLS always in force). Grant
-- it read + upsert here, or the brain's record()/list() raise "permission denied" at
-- runtime — the same omission that caused REFERRAL-500 (0037).
GRANT SELECT, INSERT, UPDATE ON scheduled_job_runs TO tovira_app;
