-- 0019_correction_prompt_version.sql — P7-2: tie each correction to the prompt
-- version that produced the original extraction, so corrections are usable as
-- training data. Nullable: older corrections (and notes never logged) have no
-- known version, and we never fabricate one.
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS prompt_version text;
