-- 0098_admin_console.sql — [P45-1] The admin plane: Tovira's operator accounts, which are NOT reps. Separate tables on
-- the OWNER pool: none is granted to tovira_app, so the rep-serving role can never read or write them, and an admin
-- has no client book, trial, billing or allowance and never appears in a rep count. Listed in the GRANT-LINT
-- OWNER_PLANE and RLS_EXEMPT allowlists.
CREATE TABLE IF NOT EXISTS admin_users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  password_hash    text,
  totp_secret_enc  text,                 -- AES-256-GCM; the key is derived from a secret outside the database
  totp_pending_enc text,                 -- shown during enrolment, not yet confirmed
  totp_enrolled_at timestamptz,
  totp_last_step   bigint,               -- a TOTP code is never accepted twice
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_email_lower CHECK (email = lower(email))
);

-- Single-use set-password links (hash only).
CREATE TABLE IF NOT EXISTS admin_invites (
  token_hash  text PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Admin sessions (hash only). mfa_ok = false: the session can only enrol or verify 2FA. 12 h idle limit in code.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash   text PRIMARY KEY,
  admin_id     uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  mfa_ok       boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Ten one-time recovery codes per admin, stored hashed.
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  admin_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at   timestamptz,
  PRIMARY KEY (admin_id, code_hash)
);

-- Every admin action: who, what, when (readable in the console).
CREATE TABLE IF NOT EXISTS admin_audit (
  id          bigserial PRIMARY KEY,
  admin_email text NOT NULL,
  action      text NOT NULL,
  target      text,
  detail      jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at DESC);
