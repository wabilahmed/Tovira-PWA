-- 0077_corrections_verdict.sql — [NO-TRAINING-RETENTION, 2026-10-02]
--
-- corrections stops being "training data" (before/after conversation content) and becomes an
-- OPERATIONAL record of the human VERDICT on a model-extracted fact (Decision 2). We record WHICH fact,
-- the verdict (confirm | reject | edit), and — for reject/edit — the KIND of correction and, for date
-- edits, the day-delta. We NEVER keep the before/after text.
--
-- ORDER: the term-pairs worth keeping were already copied to rep_glossary in 0076 (its back-fill count
-- is verified against corrections in the migration test BEFORE this runs). Here we (1) add the verdict
-- columns, (2) back-fill them from the old sentinel/field scheme, (3) lock them with CHECK constraints,
-- then (4) DROP before_value/after_value.
--
-- DATA LOSS IS INTENDED: dropping before_value/after_value destroys the retained conversation content.
-- Prod holds only the owner's own test data; nothing a real rep typed is lost.

-- (1) New verdict columns (nullable for the back-fill; verdict is set NOT NULL below).
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS verdict         text;
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS correction_kind text;
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS date_delta_days integer;

-- (2) Back-fill from the OLD scheme (only rows not already migrated):
--   field '__rejected__'  -> reject  / should_not_exist
--   field '__confirmed__' -> confirm / NULL
--   anything else         -> edit    / kind inferred from the field
--     date fields   {due_date,datetime,date,key_date}            -> date_wrong
--     person fields {owner,subject,person,sender,reports_to}     -> wrong_person
--     else                                                        -> wrong_value
-- date_delta_days is deliberately left NULL for back-filled rows: the original before/after text is not
-- reliably date-parseable in SQL, and the delta is only a forward-looking operational signal. New rows
-- compute it in the app (verdict.ts).
UPDATE corrections SET
  verdict = CASE
    WHEN field = '__rejected__'  THEN 'reject'
    WHEN field = '__confirmed__' THEN 'confirm'
    ELSE 'edit'
  END,
  correction_kind = CASE
    WHEN field = '__rejected__'  THEN 'should_not_exist'
    WHEN field = '__confirmed__' THEN NULL
    WHEN field IN ('due_date', 'datetime', 'date', 'key_date')          THEN 'date_wrong'
    WHEN field IN ('owner', 'subject', 'person', 'sender', 'reports_to') THEN 'wrong_person'
    ELSE 'wrong_value'
  END
WHERE verdict IS NULL;

-- The sentinel fields were a hack for "whole-fact" verdicts — a real field is only meaningful for edits.
-- Normalise the sentinels to '' so `field` reads as "no specific field" for confirm/reject.
UPDATE corrections SET field = '' WHERE field IN ('__rejected__', '__confirmed__');

-- (3) Lock it down.
ALTER TABLE corrections ALTER COLUMN verdict SET NOT NULL;

ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_verdict_values;
ALTER TABLE corrections ADD  CONSTRAINT corrections_verdict_values
  CHECK (verdict IN ('confirm', 'reject', 'edit'));

ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_kind_values;
ALTER TABLE corrections ADD  CONSTRAINT corrections_kind_values
  CHECK (correction_kind IS NULL
         OR correction_kind IN ('wrong_value', 'wrong_person', 'should_not_exist', 'date_wrong', 'missing'));

-- correction_kind is NULL exactly for a confirm (the model was uncertain and right); reject/edit MUST
-- carry a kind. This is the DB-enforced half of Decision 2.
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_kind_requires_verdict;
ALTER TABLE corrections ADD  CONSTRAINT corrections_kind_requires_verdict
  CHECK ((verdict = 'confirm' AND correction_kind IS NULL)
         OR (verdict IN ('reject', 'edit') AND correction_kind IS NOT NULL));

-- A day-delta is meaningful ONLY for a date correction; the column can never hold anything else (and is
-- an integer, so it can never hold text).
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_delta_only_for_dates;
ALTER TABLE corrections ADD  CONSTRAINT corrections_delta_only_for_dates
  CHECK (date_delta_days IS NULL OR correction_kind = 'date_wrong');

-- (4) Drop the retained conversation content.
ALTER TABLE corrections DROP COLUMN IF EXISTS before_value;
ALTER TABLE corrections DROP COLUMN IF EXISTS after_value;
