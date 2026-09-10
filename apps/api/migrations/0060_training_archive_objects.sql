-- 0060_training_archive_objects.sql — the index of archived training-log partitions (TRAINING-ARCHIVE).
-- Retention is now INDEFINITE: the daily sweep ARCHIVES old rows to object storage and removes them
-- from the hot table — it never deletes by age. This table records each archived object so the archive
-- is enumerable WITHOUT a storage `list` (the Storage port has none): account deletion can purge a
-- user's objects, export can include them, and /health can sum the archived corpus size.
-- One row per (user, collection, month-partition); re-archiving a partition upserts (idempotent).
CREATE TABLE IF NOT EXISTS training_archive_objects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection  text NOT NULL,            -- 'extraction_logs' | 'corrections'
  partition   text NOT NULL,            -- 'YYYY-MM' of the archived rows' created_at
  object_key  text NOT NULL,            -- the Storage key the NDJSON was written to
  row_count   integer NOT NULL DEFAULT 0,
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, collection, partition)
);
CREATE INDEX IF NOT EXISTS training_archive_objects_user_id_idx ON training_archive_objects(user_id);

ALTER TABLE training_archive_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_archive_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_archive_objects_tenant_isolation ON training_archive_objects;
CREATE POLICY training_archive_objects_tenant_isolation ON training_archive_objects
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON training_archive_objects TO tovira_app;
