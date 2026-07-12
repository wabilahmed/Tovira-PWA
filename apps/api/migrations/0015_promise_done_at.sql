-- 0015_promise_done_at.sql — timestamp promises when marked done (P4-1).
ALTER TABLE promises ADD COLUMN IF NOT EXISTS done_at timestamptz;
