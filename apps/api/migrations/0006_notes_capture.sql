-- 0006_notes_capture.sql — capture lifecycle for notes (P1-3/P1-4/P1-5).
-- Voice notes exist before they're transcribed, so raw_text becomes nullable and
-- a status + audio_key are added.
ALTER TABLE notes ALTER COLUMN raw_text DROP NOT NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'ready';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS audio_key text;
