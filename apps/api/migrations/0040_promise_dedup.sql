-- 0040_promise_dedup.sql — B2-9: write-time promise deduplication.
-- Two near-duplicate notes of ONE commitment (a rep's voice note + the client's
-- confirming message) were producing two promise rows, inflating the tracker, the
-- ledger, briefs and Book Scan. Dedup at write time so the commitment exists once
-- across every surface: a duplicate is stored as a row pointing at the canonical via
-- merged_into; the tracker (listPromisesByUser) returns canonicals only, while
-- per-note reads keep the child so every source note still shows the commitment
-- (link, don't discard).
--
-- ON DELETE SET NULL is the clean idempotency lever: when a note is re-extracted (its
-- rows deleted) or a canonical is otherwise removed, any child merged into it is
-- automatically promoted back to a canonical — one commitment survives, never zero,
-- never a dangling pointer. (For the rare 3+-duplicate case this un-merges the
-- remainder into separate canonicals: a visible, non-destructive degradation — the
-- app re-merges them on the next save.)
ALTER TABLE promises ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES promises(id) ON DELETE SET NULL;

-- The tracker query filters WHERE merged_into IS NULL; index the canonical lookups.
CREATE INDEX IF NOT EXISTS promises_merged_into_idx ON promises(merged_into);
CREATE INDEX IF NOT EXISTS promises_client_open_idx ON promises(client_id) WHERE merged_into IS NULL AND done = false;
