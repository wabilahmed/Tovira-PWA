-- 0085_billing_state.sql — [BILLING-DUNNING · D3–D7] the failed-payment lifecycle on `subscriptions`.
--
-- `status` (trialing/active/past_due/canceled) stays as-is. `billing_state` is the NEW explicit
-- failed-payment state machine, driven by webhooks + one daily job:
--   active → payment_failed (day 0–7) → suspended (day 7–30) → ended (after day 30).
-- A successful payment from payment_failed or suspended returns it to 'active'. `first_failed_at` is the
-- day-0 anchor, stamped ONCE and cleared on recovery (a replayed/repeat failure never restarts the clock).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_state text NOT NULL DEFAULT 'active';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS first_failed_at timestamptz;      -- day-0 anchor (null when active)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;        -- last app-driven invoices.pay (once/day)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS open_invoice_id text;             -- the unpaid invoice to retry / pay
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS hosted_invoice_url text;          -- Stripe hosted page for the rep to pay + do 3DS
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS hard_decline_count int NOT NULL DEFAULT 0;      -- failures that were hard declines
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auth_required_count int NOT NULL DEFAULT 0;     -- failures needing 3DS (reported separately, ruling 2)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS deletion_warned_30d boolean NOT NULL DEFAULT false; -- D8 retention warnings sent
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS deletion_warned_7d boolean NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ended_at timestamptz;             -- when billing_state became 'ended' (D8 retention clock)

-- The daily dunning job scans accounts whose clock is running or that have ended; index the hot path.
CREATE INDEX IF NOT EXISTS subscriptions_billing_state_idx ON subscriptions(billing_state)
  WHERE billing_state <> 'active';
