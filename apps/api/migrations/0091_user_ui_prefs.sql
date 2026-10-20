-- 0091_user_ui_prefs.sql — per-rep UI preferences (P36-5).
-- Which client-page sections a rep keeps open is remembered PER REP, ACROSS DEVICES, so it lives with the
-- account (not the browser). A small JSON object validated in the app (an allow-list of section keys →
-- booleans) before it is written; existing rows get '{}' = "use the page defaults", no backfill.
-- Isolation: a column on `users`, read/written only for the authenticated rep's own row, like `timezone`.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
