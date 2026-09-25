-- [SCREEN-REVIEW · RESTORE-SIGNAL] Aggregate count of how often a rep restores a held sensitive flag,
-- keyed ONLY by (category, matched span). Deliberately NO user_id / note_id / client_id and NO message
-- content: the signal is aggregate and not attributable to a rep or their book. It measures detector
-- false positives from the person best placed to judge them; it is NOT a corpus of flagged passages.
-- No RLS policy and no tenant column — it is a single global aggregate. Attribution is impossible
-- because the schema has no user/note/client column, whichever pool writes it.
CREATE TABLE IF NOT EXISTS sensitive_flag_restores (
  category   text        NOT NULL,
  span       text        NOT NULL,
  restored   bigint      NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, span)
);
GRANT SELECT, INSERT, UPDATE ON sensitive_flag_restores TO tovira_app;
