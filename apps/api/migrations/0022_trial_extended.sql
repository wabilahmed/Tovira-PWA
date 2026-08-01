-- 0022_trial_extended.sql — P5-1: the one-time activity-gated trial extension.
-- Tracks whether a trial already earned its +7 days (3+ distinct seeded clients),
-- so it can never be granted twice.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_extended boolean NOT NULL DEFAULT false;
