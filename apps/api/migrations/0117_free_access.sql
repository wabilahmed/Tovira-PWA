-- 0117_free_access.sql — [P72-2 · owner] Admin "Give free access": the account is paid until revoked, with no Stripe
-- subscription behind it. free_access_since is when it was given (the monthly allowance and spend-cap month start on
-- that day); free_access_by is the admin who gave it. NULL = no free access (every account today). Revoke sets both
-- back to NULL, so the account returns to exactly what its Stripe/trial state says. A free-access row is left out of
-- the trial-email, failed-payment and ended (90-day deletion) jobs. subscriptions is system-managed (no RLS), as before.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS free_access_since timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS free_access_by text;
