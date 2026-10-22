-- 0094_meeting_date_status.sql — [P40-1] A meeting's time is never the model's guess. When the resolver can't read
-- the phrase ("Saturday afternoon"), datetime stays NULL, datetime_raw keeps the phrase and date_status =
-- 'to_confirm': the rep answers it in Needs your answer. The answer clears it (a time) or records 'not_sure' /
-- 'no_date'. NULL = nothing to confirm (a resolved time, or a meeting the rep entered). Additive, nullable.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS date_status text
    CHECK (date_status IS NULL OR date_status IN ('to_confirm', 'not_sure', 'no_date'));
