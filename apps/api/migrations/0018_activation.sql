-- 0018_activation.sql — activation instrumentation (P7-3): when the rep first
-- viewed a useful brief. One column on users keeps it idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at timestamptz;
