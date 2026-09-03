-- 0043_meeting_note_provenance.sql — persist extraction-proposed meetings (NUDGE-UNCONFIRMED).
-- A1 found extraction computes a meeting proposal but never writes it: FLOW 15's NL path and the
-- Book Scan's meeting parts never reached the calendar. This adds provenance so extraction can
-- persist a proposal (confirmed = false) idempotently — one meeting row per source note — and the
-- rep can confirm it into a nudge-eligible meeting. Nullable: rep-created meetings have no note.

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS note_id uuid;

-- One proposed meeting per source note (idempotent re-extraction). Partial: only rows that have a
-- note; rep-created meetings (note_id NULL) are unconstrained. Tenant-scoped by user_id.
CREATE UNIQUE INDEX IF NOT EXISTS meetings_user_note_uniq
  ON meetings(user_id, note_id) WHERE note_id IS NOT NULL;
