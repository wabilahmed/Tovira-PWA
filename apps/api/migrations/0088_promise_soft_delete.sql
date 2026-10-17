-- [P20-2 / BOOK-09] Promise soft delete + undo.
-- A deleted promise is kept (deleted_at set) so the rep can Undo within 10s, and so a DSAR export still
-- carries it; a nightly job hard-deletes rows deleted more than 30 days ago. Every read surface filters
-- deleted_at IS NULL (the app code does this; the partial index keeps the common "not deleted" scans fast).
ALTER TABLE promises ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The nightly hard-delete sweep scans by deleted_at across all tenants; a partial index on the deleted
-- rows keeps it cheap without bloating the hot (deleted_at IS NULL) path.
CREATE INDEX IF NOT EXISTS promises_deleted_at_idx ON promises (deleted_at) WHERE deleted_at IS NOT NULL;

-- Rollback (manual):
--   DROP INDEX IF EXISTS promises_deleted_at_idx;
--   ALTER TABLE promises DROP COLUMN IF EXISTS deleted_at;
