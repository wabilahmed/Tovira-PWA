-- 0114_note_settled_at.sql — [P65-1 · owner] When a note finished processing (extracted, or a terminal failure), so the
-- rep's processing status can show what was found (or why it failed) for a day after, and the push can tell how long
-- it took. Cleared when a note is queued again (Try again). Older notes stay NULL (not shown). Tenant table: notes keeps
-- its RLS policy and grants.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS settled_at timestamptz;
CREATE INDEX IF NOT EXISTS notes_settled_at ON notes (user_id, settled_at) WHERE settled_at IS NOT NULL;
