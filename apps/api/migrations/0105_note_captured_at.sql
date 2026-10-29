-- 0105_note_captured_at.sql — [P57-2 · owner] A note's relative dates ("Thursday") resolve from the moment it was
-- CAPTURED, not from the day the extraction happened to run. captured_at is that moment: the recording's start for a
-- voice note (sent by the app's outbox, so a note recorded offline and uploaded later keeps its real time), the save
-- for a typed note or an "Add a note" capture. Null for older notes and imported chats (a chat anchors on its own
-- message dates); those keep the previous behaviour. Same row, same RLS as notes.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS captured_at timestamptz;
