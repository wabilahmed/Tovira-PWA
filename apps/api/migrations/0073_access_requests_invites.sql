-- 0073_access_requests_invites.sql — beta access request + invite provisioning (BETA-2b).
--
-- PRE-TENANT tables. access_requests is written by the PUBLIC request form (no user, no tenant
-- context yet); invites are consumed by an UNAUTHENTICATED visitor clicking an emailed link. So,
-- exactly like users / sessions / password_resets / email_verifications, these are NOT RLS-scoped —
-- they get no tenant_isolation policy and are simply GRANTed to tovira_app. (Recorded as RLS-exempt
-- in the RLS_EXEMPT allowlist, BETA-9.)

-- ── access_requests ──────────────────────────────────────────────────────────────────────────────
-- conversation_ownership codes map to the form's exact option text (BETA-3):
--   own_clients          = "My own clients. I hold the relationship directly."
--   brokerage_i_manage   = "Clients of the brokerage I own or manage."
--   brokerage_employs_me = "Clients of the brokerage that employs me."
--   mix                  = "A mix of the above."
--   other                = "Other" (free text in conversation_ownership_other)
CREATE TABLE IF NOT EXISTS access_requests (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  status                       text NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'approved', 'rejected', 'invited', 'activated')),
  -- submitted fields
  full_name                    text NOT NULL,
  work_email                   text NOT NULL,
  phone                        text NOT NULL,
  company_name                 text NOT NULL,
  role_title                   text NOT NULL,
  ownership                    text NOT NULL CHECK (ownership IN ('owns_or_manages', 'employed')),
  trade_licence_number         text,            -- only meaningful for owns_or_manages (see CHECK below)
  conversation_ownership       text NOT NULL
                                 CHECK (conversation_ownership IN ('own_clients', 'brokerage_i_manage', 'brokerage_employs_me', 'mix', 'other')),
  conversation_ownership_other text,            -- free text, only when conversation_ownership = 'other'
  expected_volume              text NOT NULL CHECK (expected_volume IN ('under_50', '50_200', '200_500', '500_plus')),
  -- the mandatory truth/authority confirmation (NOT terms acceptance — that happens at invite consumption)
  confirmation_accepted_at     timestamptz NOT NULL,
  confirmation_text_version    text NOT NULL,
  -- request provenance (best-effort; nullable)
  source_ip                    text,
  user_agent                   text,
  -- review outcome
  reviewed_at                  timestamptz,
  reviewed_note                text,
  linked_user_id               uuid REFERENCES users(id) ON DELETE SET NULL,  -- keep the audit row if the account is later deleted

  -- Defense-in-depth invariants. REQUIREDNESS (owns_or_manages must supply a licence) lives in
  -- application validation, which owns that product rule and must not reject a partial draft here.
  -- These two CHECKs instead forbid states that are never legitimate for ANY writer, catching a
  -- client/validation bug before it writes a nonsensical row:
  CONSTRAINT access_requests_employed_no_licence
    CHECK (ownership <> 'employed' OR trade_licence_number IS NULL),
  CONSTRAINT access_requests_other_text_only_when_other
    CHECK (conversation_ownership = 'other' OR conversation_ownership_other IS NULL)
);
CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests(status, created_at);
CREATE INDEX IF NOT EXISTS access_requests_work_email_idx ON access_requests(work_email);
GRANT SELECT, INSERT, UPDATE, DELETE ON access_requests TO tovira_app;

-- ── invites ──────────────────────────────────────────────────────────────────────────────────────
-- Structural copy of password_resets (0029): only the SHA-256 token HASH is stored and it IS the
-- primary key; the raw token lives only in the email. Single-use burn is the same atomic shape as
-- resets, using consumed_at IS NULL instead of a used flag:
--   UPDATE invites SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING user_id
CREATE TABLE IF NOT EXISTS invites (
  token_hash        text PRIMARY KEY,
  access_request_id uuid NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  created_by        text NOT NULL   -- who provisioned the invite (the ops operator identifier)
);
CREATE INDEX IF NOT EXISTS invites_access_request_idx ON invites(access_request_id);
CREATE INDEX IF NOT EXISTS invites_user_idx ON invites(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON invites TO tovira_app;
