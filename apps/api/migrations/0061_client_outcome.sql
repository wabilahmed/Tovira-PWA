-- 0061_client_outcome.sql [OUTCOME-1] — deal outcome per client (capture only, no analysis).
-- Start accumulating win/loss outcome data so a FUTURE best-practices analysis has something to
-- correlate behavioural metrics against. This migration only adds the columns; nothing here
-- aggregates, surfaces, or infers (inference is the nightly rule in OUTCOME-2, app-side).
--
-- Isolation: `clients` already has RLS ENABLE + FORCE and the tenant-isolation policy (0003), plus
-- the composite UNIQUE (user_id, id) key (0036). New columns inherit that policy automatically —
-- a client's outcome is readable/writable ONLY by its owner, enforced at the DB, not just in app code.
--
-- outcome_source ('rep' | 'inferred') is stored explicitly, NOT derived from the outcome value: a
-- later analysis must be able to tell a rep-confirmed loss from a silence-inferred one, because the
-- two may skew results differently. Without the column they are indistinguishable and the dataset
-- is far less useful. Null while the outcome is the untouched default 'open'.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'open'
    CHECK (outcome IN ('open', 'won', 'lost_confirmed', 'lost_inferred')),
  ADD COLUMN IF NOT EXISTS outcome_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_source text
    CHECK (outcome_source IN ('rep', 'inferred'));

-- Two invariants (note: a rep can explicitly set 'still open' — that is outcome='open' WITH a
-- source, distinct from the untouched default where both are null):
--   (a) source and changed-at travel together — either both null (untouched) or both set (touched);
--   (b) any non-'open' outcome must carry a source — you cannot be won/lost/lost_inferred by accident.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_outcome_source_ck;
ALTER TABLE clients ADD  CONSTRAINT clients_outcome_source_ck
  CHECK ((outcome_source IS NULL) = (outcome_changed_at IS NULL)
         AND (outcome = 'open' OR outcome_source IS NOT NULL));

-- The nightly silence rule (OUTCOME-2) scans a rep's clients by outcome; this keeps that per-tenant.
CREATE INDEX IF NOT EXISTS clients_user_id_outcome_idx ON clients(user_id, outcome);
