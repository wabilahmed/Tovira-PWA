-- 0072_terms_acceptance_rename.sql — PDPL de-conflation (BETA-2a).
-- These columns record acceptance of CONTRACTUAL TERMS, which is a distinct thing from
-- "consent" as a named lawful basis for processing under the UAE PDPL. A column called
-- consent_version is evidence of the very conflation counsel flagged in a document we may
-- have to produce to a regulator. Rename now, while the table holds no production data, so
-- there is one acceptance concept and one authoritative set of columns.
--
-- RENAME preserves existing values: an account already holding consent_version '2026-08-01'
-- keeps terms_version_accepted = '2026-08-01' (an accurate record of what that person saw).
-- Do NOT rewrite those values.
ALTER TABLE users RENAME COLUMN consent_at TO terms_accepted_at;
ALTER TABLE users RENAME COLUMN consent_version TO terms_version_accepted;
-- The IP the acceptance was recorded from — completes the acceptance evidence (who, what
-- version, when, from where). Null for accounts that never saw a terms screen.
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_ip text;
