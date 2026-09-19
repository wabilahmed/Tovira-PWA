-- 0065_fact_capture_at.sql [RECEIPTS-capture-date] — additive, nullable capture-date column.
--
-- The receipt capture-date fallback (rendered when a fact has no per-message timestamp) must show the
-- CONVERSATION date, not the import date. A fact row's created_at is its insert time — for an imported
-- chat that is when the import ran, not when the conversation happened (see 0065 findings). This adds
-- capture_at: the note's referenceDate, denormalised onto each fact at write time.
--
-- TYPE = text, holding a YYYY-MM-DD date. Rationale: capture_at is a DISPLAY date (the receipt renders a
-- day, never a clock time), it is written verbatim from extraction's referenceDate string (already
-- YYYY-MM-DD from referenceDateFor), and storing text avoids node-pg coercing a `date` column into a
-- local-midnight Date (a timezone hazard for a value that is purely for display).
--
-- Source of the value: referenceDateFor(note, today) — the latest message's date for an imported chat,
-- the caller's `today` (= capture date) for a fresh voice/paste note. The SAME date the extractor
-- already resolves relative dates against, so the receipt agrees with the resolved facts.
--
-- Safe to ship: NULLABLE, no default, no constraint. Facts written before this migration keep
-- capture_at NULL and fall back honestly (a missing date is better than a wrong one). Purely additive.
--
-- REVERSE (down-migration):
--   ALTER TABLE promises  DROP COLUMN IF EXISTS capture_at;
--   ALTER TABLE key_dates DROP COLUMN IF EXISTS capture_at;
--   ALTER TABLE meetings  DROP COLUMN IF EXISTS capture_at;

ALTER TABLE promises  ADD COLUMN IF NOT EXISTS capture_at text;
ALTER TABLE key_dates ADD COLUMN IF NOT EXISTS capture_at text;
ALTER TABLE meetings  ADD COLUMN IF NOT EXISTS capture_at text;
