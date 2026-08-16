-- 0034_email_verification.sql — soft email verification (EMAIL-VERIFY). Full
-- access is never gated on this; it only lets us reach the rep about their trial.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_created_idx ON email_verifications(user_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON email_verifications TO tovira_app;
