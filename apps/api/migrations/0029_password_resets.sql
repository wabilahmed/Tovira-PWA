-- 0029_password_resets.sql — single-use, expiring password-reset tokens (TASK
-- EMAIL). Only the token HASH is stored; the raw token lives only in the email.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON password_resets TO tovira_app;
