-- 0017_billing.sql — trials + subscriptions (P5-1/P5-2). These are SYSTEM tables
-- (webhooks have no user context), so no RLS; access is filtered explicitly.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'trialing',
  trial_ends_at          timestamptz NOT NULL,
  stripe_customer_id     text,
  stripe_subscription_id text,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions(stripe_customer_id);

-- Anti-farming: durable per-email grant, NOT tied to a user (survives deletion).
CREATE TABLE IF NOT EXISTS trial_grants (
  email      text PRIMARY KEY,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- Webhook idempotency.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions, trial_grants, webhook_events TO tovira_app;

-- Consent captured at signup (P5-4).
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at timestamptz;
