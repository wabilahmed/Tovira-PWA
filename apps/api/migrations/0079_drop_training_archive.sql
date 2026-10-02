-- 0079_drop_training_archive.sql — [NO-TRAINING-RETENTION, 2026-10-02]
--
-- The training-archive subsystem is deleted, not disabled: there is no longer any content to archive
-- (extraction_logs/corrections are metadata-only as of 0077/0078), so the index of archived partitions
-- has no purpose. Drop it.
--
-- DATA LOSS IS INTENDED. The object-storage prefix the index pointed at was never written in prod (the
-- archive destination was never configured), so there are no live objects this strands; the owner
-- confirms the prefix is empty with the `aws s3 ls` command in the batch report before this ships.

DROP TABLE IF EXISTS training_archive_objects;
