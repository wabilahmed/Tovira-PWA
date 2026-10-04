-- 0083_notes_claimed_at.sql — [BULK-IMPORT · RULING 2 item 2] atomic extraction claim
--
-- A note is drained for extraction by at most one worker. The drainer flips pending_extraction →
-- 'extracting' in a single atomic conditional UPDATE (see PgNoteRepository.claimForExtraction), stamping
-- claimed_at. A claim older than the sweep's reclaim timeout is treated as a crashed worker and flipped
-- back to pending_extraction (reclaimStaleExtracting). 'extracting' is a plain status string (the status
-- column is text, not an enum) so no type change is needed — only the timestamp column.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- The sweep's reclaim scans for stale 'extracting' notes; index the hot path.
CREATE INDEX IF NOT EXISTS notes_extracting_claimed_at_idx ON notes (claimed_at) WHERE status = 'extracting';
