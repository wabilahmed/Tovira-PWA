-- 0033_note_sweep_attempts.sql — bounded-retry counter for the server-side note
-- sweep (FLOWS-7). A note stuck at pending_transcription/extraction is advanced
-- by a scheduled job; after N attempts it becomes needs_review, never lost.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS sweep_attempts integer NOT NULL DEFAULT 0;
