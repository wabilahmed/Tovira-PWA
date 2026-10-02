-- 0078_extraction_logs_metadata.sql — [NO-TRAINING-RETENTION, 2026-10-02]
--
-- The extraction log becomes OPERATIONAL METADATA ONLY. It stops storing the note input and the raw
-- model output (the content it was retaining "for a future self-hosted model"); the note text already
-- lives in `notes` and accepted facts in `facts`, so the log needs neither to be investigable.
--
-- In their place it records fact-quality COUNTS — how many facts the model proposed, how many were
-- accepted into the vault, how many were rejected, and a per-reason count-map — so an empty or starved
-- run is observable without keeping a single word of conversation content.
--
-- DATA LOSS IS INTENDED: dropping input/raw_output destroys the retained content. Prod holds only the
-- owner's own test data.

ALTER TABLE extraction_logs ADD COLUMN IF NOT EXISTS facts_proposed     integer NOT NULL DEFAULT 0;
ALTER TABLE extraction_logs ADD COLUMN IF NOT EXISTS facts_accepted     integer NOT NULL DEFAULT 0;
ALTER TABLE extraction_logs ADD COLUMN IF NOT EXISTS facts_rejected     integer NOT NULL DEFAULT 0;
-- A fixed, extensible set of COUNT keys ({health, date_invariant, held_for_confirmation}), never free
-- text. jsonb, defaulting to an empty object.
ALTER TABLE extraction_logs ADD COLUMN IF NOT EXISTS rejected_by_reason jsonb   NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE extraction_logs DROP COLUMN IF EXISTS input;
ALTER TABLE extraction_logs DROP COLUMN IF EXISTS raw_output;
