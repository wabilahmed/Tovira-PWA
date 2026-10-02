-- 0076_rep_glossary.sql — [NO-TRAINING-RETENTION, 2026-10-02]
--
-- The per-rep extraction glossary (P4-9) moves OUT of corrections.before/after and into its own
-- OPERATIONAL table, so a later migration can drop the conversation-derived before/after text from
-- corrections without losing the glossary. Term-sized only (1–40 chars, DB-enforced), fed only by edit
-- corrections. This migration also BACK-FILLS the qualifying pairs that already exist in corrections.
--
-- ORDER MATTERS: create the table, back-fill it (as the migration superuser, so BEFORE row-level
-- security is forced — otherwise the owner would be blocked by its own policy), then lock RLS down. The
-- drop of corrections.before_value/after_value is a SEPARATE later migration, run only after the
-- back-fill counts are verified against corrections (see the migration test).

CREATE TABLE IF NOT EXISTS rep_glossary (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrong_term      text NOT NULL,
  right_term      text NOT NULL,
  times_corrected integer NOT NULL DEFAULT 1,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  last_seen       timestamptz NOT NULL DEFAULT now(),
  -- Term-sized ONLY and never a no-op pair: the glossary is names/jargon, never note text or paragraphs.
  CONSTRAINT rep_glossary_wrong_len CHECK (char_length(wrong_term) BETWEEN 1 AND 40),
  CONSTRAINT rep_glossary_right_len CHECK (char_length(right_term) BETWEEN 1 AND 40),
  CONSTRAINT rep_glossary_distinct  CHECK (wrong_term <> right_term),
  UNIQUE (user_id, wrong_term, right_term)
);
CREATE INDEX IF NOT EXISTS rep_glossary_user_id_idx ON rep_glossary(user_id);

-- Back-fill: the SAME filter buildGlossary applied to corrections (skip the non-term fields + verdict
-- sentinels; both values present, differing, 1–40 chars). Aggregate occurrences into times_corrected.
INSERT INTO rep_glossary (user_id, wrong_term, right_term, times_corrected, first_seen, last_seen)
SELECT user_id, before_value, after_value, count(*)::int, min(created_at), max(created_at)
FROM corrections
WHERE field NOT IN ('due_date', 'due_raw', 'confidence', '__rejected__', '__confirmed__')
  AND before_value IS NOT NULL AND after_value IS NOT NULL
  AND before_value <> after_value
  AND char_length(before_value) BETWEEN 1 AND 40
  AND char_length(after_value) BETWEEN 1 AND 40
GROUP BY user_id, before_value, after_value
ON CONFLICT (user_id, wrong_term, right_term) DO NOTHING;

ALTER TABLE rep_glossary ENABLE ROW LEVEL SECURITY;
ALTER TABLE rep_glossary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_glossary_tenant_isolation ON rep_glossary;
CREATE POLICY rep_glossary_tenant_isolation ON rep_glossary
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON rep_glossary TO tovira_app;
