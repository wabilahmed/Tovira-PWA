-- 0064_fact_receipts.sql [RECEIPTS-v0.9.5] — additive, nullable per-fact receipt columns.
--
-- Prepares storage for the v0.9.5 prompt (per-fact receipts) WITHOUT changing anything today. Adds
-- source_span (the verbatim excerpt a fact was drawn from) and source_message_at (the source message's
-- timestamp) to the three fact TABLES that lack a self-contained receipt: promises, key_dates, meetings.
-- people + personal_facts live in notes.extracted JSONB and need no DDL — the v0.9.5 model output will
-- carry the two fields inline in that JSONB. requirements (requirement_raw) and unanswered_questions
-- (question + sentAt) already carry a receipt and are untouched.
--
-- Safe to ship now: the columns are NULLABLE with NO default and NO NOT NULL, and current v0.9.4 output
-- never sets them (the repos' INSERTs list explicit columns), so existing writes leave them NULL and
-- nothing reads them until v0.9.5 is certified and wired. Purely additive — no data transform, no
-- backfill, no constraint — so it is trivially reversible.
--
-- REVERSE (down-migration):
--   ALTER TABLE promises  DROP COLUMN IF EXISTS source_span, DROP COLUMN IF EXISTS source_message_at;
--   ALTER TABLE key_dates DROP COLUMN IF EXISTS source_span, DROP COLUMN IF EXISTS source_message_at;
--   ALTER TABLE meetings  DROP COLUMN IF EXISTS source_span, DROP COLUMN IF EXISTS source_message_at;

ALTER TABLE promises  ADD COLUMN IF NOT EXISTS source_span text,
                      ADD COLUMN IF NOT EXISTS source_message_at timestamptz;
ALTER TABLE key_dates ADD COLUMN IF NOT EXISTS source_span text,
                      ADD COLUMN IF NOT EXISTS source_message_at timestamptz;
ALTER TABLE meetings  ADD COLUMN IF NOT EXISTS source_span text,
                      ADD COLUMN IF NOT EXISTS source_message_at timestamptz;
