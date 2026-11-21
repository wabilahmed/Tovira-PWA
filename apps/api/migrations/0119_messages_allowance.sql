-- 0119_messages_allowance.sql — [P83 · owner, 21 Nov] Messages are what a rep buys and sees.
--
-- Each monthly window now also counts MESSAGES: the plan's messages (10,000 on AED 299), the pack messages available
-- (carried in + bought; packs never expire), and the messages read from imported chats (stripped of chatter). Notes and
-- voice notes never count. The AED columns stay: the AED gate is still the real money limit behind the messages.
ALTER TABLE ai_usage_month ADD COLUMN IF NOT EXISTS messages_allowance  integer NOT NULL DEFAULT 10000;
ALTER TABLE ai_usage_month ADD COLUMN IF NOT EXISTS messages_topup      integer NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_month ADD COLUMN IF NOT EXISTS messages_used       integer NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_month ADD COLUMN IF NOT EXISTS last_topup_messages integer;
ALTER TABLE ai_usage_month DROP CONSTRAINT IF EXISTS ai_usage_month_messages_nonneg;
ALTER TABLE ai_usage_month ADD CONSTRAINT ai_usage_month_messages_nonneg
  CHECK (messages_allowance >= 0 AND messages_topup >= 0 AND messages_used >= 0);

-- An unspent AED top-up bought before this change becomes messages at the plan's ratio (AED 60 = 10,000 messages), so
-- nobody loses what they paid for. Runs once: only rows that have no pack messages yet.
UPDATE ai_usage_month
   SET messages_topup = floor(GREATEST(0, topup_aed - GREATEST(0, spent_aed - allowance_aed)) * 10000 / allowance_aed)
 WHERE topup_aed > 0 AND allowance_aed > 0 AND messages_topup = 0;

-- One row per imported chat whose messages were counted, so a chat read twice (a retry, a second worker) is counted
-- once. No foreign key to notes: an undone import keeps its count (the messages were read).
CREATE TABLE IF NOT EXISTS ai_message_charge (
  note_id    uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  messages   integer NOT NULL CHECK (messages > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_message_charge_user_idx ON ai_message_charge(user_id, period_key);

ALTER TABLE ai_message_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_message_charge FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_message_charge_tenant_isolation ON ai_message_charge;
CREATE POLICY ai_message_charge_tenant_isolation ON ai_message_charge
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_message_charge TO tovira_app;
