-- 0026_subscription_period_end.sql — the renewal date (P5-2). Stored straight
-- from the Stripe webhook (current_period_end); the UI renders "Renews DD MON
-- YYYY" from it and shows nothing when it's null. Never inferred locally.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
