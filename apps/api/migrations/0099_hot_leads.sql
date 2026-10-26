-- 0099_hot_leads.sql — [P45-3] Hot leads from the outreach platform (Explee), pulled every 10 minutes, for the admin
-- console only. Leads are personal data about prospects: OWNER pool only (never granted to tovira_app, never read by
-- a rep route) and never sent to any model. Listed in the GRANT-LINT OWNER_PLANE and RLS_EXEMPT allowlists.
CREATE TABLE IF NOT EXISTS hot_leads (
  id                bigserial PRIMARY KEY,
  person_id         text NOT NULL,
  campaign_id       integer NOT NULL,
  campaign_name     text,
  name              text,
  email             text,
  job_title         text,
  company_name      text,
  company_domain    text,
  linkedin_url      text,
  country           text,
  phone             text,
  why_hot           text,                 -- their reply, verbatim
  became_hot_at     timestamptz,
  erased            boolean NOT NULL DEFAULT false, -- the person asked Explee to remove them: nothing of them is kept
  status            text NOT NULL DEFAULT 'new'
                      CONSTRAINT hot_leads_status_check CHECK (status IN ('new', 'contacted', 'invited', 'signed_up', 'not_interested')),
  notes             text,
  access_request_id uuid REFERENCES access_requests(id) ON DELETE SET NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- the at-or-after overlap of `since` never creates a duplicate
  CONSTRAINT hot_leads_person_campaign UNIQUE (person_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS hot_leads_became_hot ON hot_leads (became_hot_at DESC);
CREATE INDEX IF NOT EXISTS hot_leads_email ON hot_leads (lower(email));

-- One row: the sync cursor (the newest became_hot_at saved) and the console's banner state.
CREATE TABLE IF NOT EXISTS explee_sync_state (
  id          boolean PRIMARY KEY DEFAULT true CONSTRAINT explee_sync_state_one_row CHECK (id),
  cursor      timestamptz,
  last_run_at timestamptz,
  last_status text,          -- ok | not_configured | rate_limited | no_credit | key_rejected | unavailable
  banner      text           -- shown in the console while set (credit out, key rejected); cleared by a good run
);

-- "Invite to beta" turns a lead into a PENDING access request for the normal approve flow. A lead never answered the
-- form's questions (phone, ownership, whose conversations, volume) or gave the form's confirmation, so those may be
-- empty for source 'hot_lead' only; a form request must still have every answer.
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'form';
ALTER TABLE access_requests
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN ownership DROP NOT NULL,
  ALTER COLUMN conversation_ownership DROP NOT NULL,
  ALTER COLUMN expected_volume DROP NOT NULL,
  ALTER COLUMN confirmation_accepted_at DROP NOT NULL,
  ALTER COLUMN confirmation_text_version DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_requests_source_check') THEN
    ALTER TABLE access_requests ADD CONSTRAINT access_requests_source_check CHECK (source IN ('form', 'hot_lead'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_requests_form_complete') THEN
    ALTER TABLE access_requests ADD CONSTRAINT access_requests_form_complete CHECK (
      source <> 'form' OR (phone IS NOT NULL AND ownership IS NOT NULL AND conversation_ownership IS NOT NULL
        AND expected_volume IS NOT NULL AND confirmation_accepted_at IS NOT NULL AND confirmation_text_version IS NOT NULL));
  END IF;
END $$;
