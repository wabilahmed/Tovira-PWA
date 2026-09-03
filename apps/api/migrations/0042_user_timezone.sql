-- 0042_user_timezone.sql — per-rep IANA timezone (NUDGE-TZ).
-- "2 hours before" is meaningless without a clock, and a Dubai rep on a UTC
-- server is nudged four hours off. We store an IANA name (not a fixed offset)
-- so DST in the markets we expand to is handled; the default is the launch ICP.
-- The value is validated in the app (Intl) before it is written; the column is a
-- plain text default so existing rows get the launch default with no backfill.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Dubai';
