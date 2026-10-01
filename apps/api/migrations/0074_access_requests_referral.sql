-- 0074_access_requests_referral.sql — carry a referral code across the approval delay (BETA-3b/4).
--
-- Self-serve signup credited referrals inline (body.ref -> ReferralService at signup). In the invite
-- flow, form submission and account creation are separated by however long review takes, so a referral
-- code captured on the landing page is lost unless it is persisted here and applied when the user is
-- created at approval (BETA-5). Nullable: most requests carry no code.
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS referral_code text;
