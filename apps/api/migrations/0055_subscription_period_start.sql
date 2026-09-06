-- 0055_subscription_period_start.sql [BILLING-PERIOD] — the START of the current paid period, the
-- spend-cap bucket anchor. Stored straight from the Stripe webhook (current_period_start), alongside
-- current_period_end. Null for trials and for subscriptions created before this column existed; the
-- app falls back explicitly (a `pf:`/`t:` bucket key), NEVER inventing an authoritative start.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start timestamptz;
