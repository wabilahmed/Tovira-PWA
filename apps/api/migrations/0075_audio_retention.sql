-- [AUDIO-RETENTION] A durable voice recording (S3, since task-def rev 77) is deleted
-- AUDIO_RETENTION_DAYS (30) after its transcription SUCCEEDS — not after upload.
--
-- transcribed_at is the retention clock: set when a transcript is stored (TranscriptionService), left
-- NULL while a note is pending or terminally transcription_failed. A note that never transcribed keeps
-- its recording indefinitely — it is the only copy of the capture, so the sweep excludes NULL and
-- transcription_failed.
--
-- audio_expired_at records that the retention sweep (or a single-counterparty erasure) deleted the audio
-- object; audio_key is cleared at the same time, so GET /notes/:id/audio can report "no longer kept"
-- (the transcript remains) instead of a bare 404.
--
-- Both columns inherit the existing row-level security on notes (policy is table-level), so no new policy
-- is needed. IF NOT EXISTS keeps the migration idempotent.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS transcribed_at   timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS audio_expired_at timestamptz;

-- The retention sweep scans per rep for still-held recordings past the window. A partial index keeps it
-- cheap: only rows that still have an audio object and a transcription timestamp are candidates.
CREATE INDEX IF NOT EXISTS notes_audio_retention_idx
  ON notes (transcribed_at)
  WHERE audio_key IS NOT NULL AND transcribed_at IS NOT NULL;
