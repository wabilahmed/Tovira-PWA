-- 0086_erasure_request_terminal_states.sql [TASK 2] — document the two new NON-erasing terminal states
-- of an erasure request: `rejected` (operator decided it is not carried out — e.g. an asserted
-- retention basis is upheld) and `withdrawn` (the requester took the request back). Either ends the
-- processing-restriction window WITHOUT deleting anything; the data stays in place.
--
-- The `status` column is free text (migration 0066 added NO CHECK constraint — the allowed values are
-- enforced in the app, see apps/api/src/ports/erasure-request-repository.ts). So this migration changes
-- NO schema or data: it only refreshes the column comment so the database stays self-documenting.
-- Idempotent and safe to re-run.

COMMENT ON COLUMN erasure_requests.status IS
  'pending | retention_asserted | completed | rejected | withdrawn (app-enforced; rejected/withdrawn are non-erasing terminal states that lift the processing restriction)';
