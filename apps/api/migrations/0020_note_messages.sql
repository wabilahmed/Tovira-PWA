-- 0020_note_messages.sql — P1-4b: WhatsApp chat-export import. A note can now be
-- a whole imported thread; the parsed, speaker-attributed messages live as JSONB
-- on the note (raw file stays in raw_text, persisted before parsing).
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_source_check;
ALTER TABLE notes ADD CONSTRAINT notes_source_check
  CHECK (source IN ('voice', 'paste', 'whatsapp_export'));
ALTER TABLE notes ADD COLUMN IF NOT EXISTS messages jsonb;
