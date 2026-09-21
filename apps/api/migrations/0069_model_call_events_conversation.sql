-- [SPEND-INSTRUMENT · ASK-CONVO] Conversation attribution on the per-call event log (B4). A recall turn
-- is one model call in a conversation; these two columns let the SAME durable log answer "what did this
-- 20-turn conversation cost, and how does per-turn cost grow as context accretes" — no parallel store.
-- Both NULL for one-shot calls (extraction/import): those are not conversations.
ALTER TABLE model_call_events ADD COLUMN IF NOT EXISTS conversation_id text; -- the recall session; NULL = not a conversation
ALTER TABLE model_call_events ADD COLUMN IF NOT EXISTS turn_index integer;   -- 1-based turn within the conversation
-- Per-turn read is scoped to one rep's one conversation, ordered by turn.
CREATE INDEX IF NOT EXISTS model_call_events_conversation ON model_call_events (user_id, conversation_id, turn_index);
