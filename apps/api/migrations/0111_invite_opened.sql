-- 0111_invite_opened.sql — [P63-5 · owner] Admin → Funnel: "invite link opened" was never recorded. From this deploy, the
-- first time the invite link's request form loads with its live token. hot_leads stays OWNER pool only.
ALTER TABLE hot_leads ADD COLUMN IF NOT EXISTS invite_opened_at timestamptz;
