-- 0113_invite_delivery.sql — [P63-9 · owner] The invite email's delivery status on each lead card, from Resend's
-- delivery webhooks: delivered, bounced or complained (marked spam). Never opens or clicks. hot_leads stays OWNER pool only.
ALTER TABLE hot_leads
  ADD COLUMN IF NOT EXISTS invite_delivery    text CHECK (invite_delivery IN ('delivered', 'bounced', 'complained')),
  ADD COLUMN IF NOT EXISTS invite_delivery_at timestamptz;
