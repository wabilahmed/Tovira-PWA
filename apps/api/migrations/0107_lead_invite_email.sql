-- 0107_lead_invite_email.sql — [P58-3 · owner] Admin → Leads → "Send invite email": the founder emails a hot lead a beta
-- invite whose button opens the request form, prefilled from the lead. Same table, same rule: hot_leads is personal data
-- about prospects, OWNER pool only (never granted to tovira_app).
--  * status gains 'requested' (the lead submitted the form from the invite): new → invited → requested → signed_up.
--  * is_test: a lead the owner adds by hand to try the email on himself; never counted, never exported.
--  * the invite: only the HASH of its single token (the raw token lives in the email alone), when it was sent, when it was
--    re-sent (once, after 3 days), when it expires (14 days), and when it was used (single use, on submit).
ALTER TABLE hot_leads DROP CONSTRAINT IF EXISTS hot_leads_status_check;
ALTER TABLE hot_leads ADD CONSTRAINT hot_leads_status_check
  CHECK (status IN ('new', 'contacted', 'invited', 'requested', 'signed_up', 'not_interested'));
ALTER TABLE hot_leads
  ADD COLUMN IF NOT EXISTS is_test           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS invite_resent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_used_at    timestamptz,
  ADD COLUMN IF NOT EXISTS requested_at      timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS hot_leads_invite_token ON hot_leads (invite_token_hash) WHERE invite_token_hash IS NOT NULL;
