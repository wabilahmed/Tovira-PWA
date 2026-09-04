-- MISFILE-POST (B2): a soft, deterministic suggestion that a note may belong to another client.
-- Stored on the note; surfaced in the confirmation queue; cleared once the rep acts. Nullable —
-- the vast majority of notes carry no suggestion. RLS already covers `notes` (0004), so this
-- column inherits per-rep isolation; no policy change is needed.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS move_suggestion jsonb;

-- The confirmation queue lists only the few notes that carry a suggestion — a partial index keeps
-- that scan cheap without bloating the common no-suggestion case.
CREATE INDEX IF NOT EXISTS notes_move_suggestion_idx
  ON notes (user_id)
  WHERE move_suggestion IS NOT NULL;
