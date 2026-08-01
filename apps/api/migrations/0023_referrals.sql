-- 0023_referrals.sql — P5-6 referral anti-farming ledger. A referred email is
-- credited at most once (PRIMARY KEY), so repeat-referring the same person earns
-- nothing. Global (not tenant-scoped), like trial_grants — an anti-abuse record.
CREATE TABLE IF NOT EXISTS referrals (
  referred_email text PRIMARY KEY,
  referrer_id    uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
