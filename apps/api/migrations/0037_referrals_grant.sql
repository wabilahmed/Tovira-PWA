-- 0037_referrals_grant.sql — fix REFERRAL-500. The referrals table (0023) was
-- created without granting privileges to the non-superuser app role tovira_app,
-- unlike every other table (trial_grants got its grant in 0017). At runtime the API
-- connects as tovira_app, so INSERT INTO referrals raised "permission denied" — but
-- ONLY for a valid referral (a garbage code bails before the insert), and never in
-- the in-memory tests. The result: a real referral 500'd and credited no one.
-- referrals is a global anti-abuse ledger (no RLS), like trial_grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON referrals TO tovira_app;
