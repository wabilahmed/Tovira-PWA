-- 0045_extraction_log_survives_note_delete.sql — the training log outlives its note (ASK-CAPTURE).
-- Rejecting an Ask-captured statement DELETES the pending note, but its extraction_logs row is
-- genuine data about what the CERTIFIED extractor produced from that input — especially valuable
-- distillation signal (a human said "no"). The log is self-contained (it stores the input + output +
-- prompt version), so it needs no note. Change note_id CASCADE → SET NULL so a note delete orphans
-- the log instead of erasing it. Account delete still purges every log via the user_id cascade
-- (privacy), and the composite (user_id, note_id) FK — the IDOR net from 0036 — is preserved.

ALTER TABLE extraction_logs ALTER COLUMN note_id DROP NOT NULL;
ALTER TABLE extraction_logs DROP CONSTRAINT IF EXISTS extraction_logs_user_id_note_id_fkey;
ALTER TABLE extraction_logs ADD  CONSTRAINT extraction_logs_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE SET NULL;
