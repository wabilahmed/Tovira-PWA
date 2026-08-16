-- 0028_user_referral_code.sql — an OPAQUE per-user referral code (P5-6) so the
-- shareable link never carries the raw user id. Backfill any existing rows with
-- a random urlsafe code; new rows always set it at signup. UNIQUE so a code
-- resolves to exactly one referrer.
-- gen_random_bytes() needs pgcrypto; guard here too so this migration self-heals
-- on a database created before 0001 enabled it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text;
UPDATE users SET referral_code = encode(gen_random_bytes(6), 'base64')
  WHERE referral_code IS NULL;
-- base64 can contain +,/,= — make it urlsafe and strip padding for a clean link.
UPDATE users SET referral_code = replace(replace(replace(referral_code, '+', '-'), '/', '_'), '=', '');
ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx ON users(referral_code);
