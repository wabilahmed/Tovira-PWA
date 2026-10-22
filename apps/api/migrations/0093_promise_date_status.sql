-- 0093_promise_date_status.sql — [P40-1] A promise's date is never the model's guess. When the deterministic
-- resolver can't produce a date, due_date stays NULL, due_raw keeps the phrase ("Sunday morning") and
-- date_status = 'to_confirm': the rep answers it in Needs your answer. The rep's answer clears it (a date), or
-- records 'not_sure' / 'no_due_date'. NULL = nothing to confirm (a resolved date, or no phrase at all).
-- Additive, nullable, no backfill here: existing rows are reviewed by the promise-dates dry run (owner-run).
ALTER TABLE promises
  ADD COLUMN IF NOT EXISTS date_status text
    CHECK (date_status IS NULL OR date_status IN ('to_confirm', 'not_sure', 'no_due_date'));
