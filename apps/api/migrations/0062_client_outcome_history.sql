-- 0062_client_outcome_history.sql [OUTCOME-FOLLOWUP-2] — append-only history of outcome transitions.
-- The clients.outcome field is a live snapshot: when an inferred loss revives, the inference vanishes
-- with no trace, which makes the key calibration question — how often does an inferred loss come
-- back? — unanswerable. This table keeps every transition (rep-sourced OR inferred, including
-- reversions to open) so that question is answerable later. Cheap now, impossible to reconstruct later.
--
-- `source` is the ACTOR of the transition ('rep' | 'inferred'), NOT necessarily the client's resulting
-- outcome_source: a rep tapping "still open" on an inferred loss logs (lost_inferred -> open, 'rep')
-- while the client's outcome_source returns to null. That is exactly what lets a later analysis tell a
-- rep-revival from an activity-revival.
--
-- Isolation: same model as clients — RLS ENABLE + FORCE + tenant policy, and a composite FK
-- (user_id, client_id) -> clients(user_id, id) so a cross-tenant reference is a DB error, not a
-- handler check (the IDOR net, 0036). Append-only is enforced at the grant level: SELECT + INSERT
-- only, NO UPDATE/DELETE for the app role.
--
-- Deletion: rows are removed ONLY by cascade — (user_id) -> users(id) ON DELETE CASCADE purges them on
-- account deletion (AccountService.deleteAccount -> auth.deleteUser drops the users row), the SAME
-- mechanism that already purges extraction_logs, corrections, notes, etc.; and (user_id, client_id) ->
-- clients ON DELETE CASCADE purges them if a single client is removed. No app-level delete path exists
-- or is needed.

CREATE TABLE IF NOT EXISTS client_outcome_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL,
  prev_outcome text NOT NULL CHECK (prev_outcome IN ('open', 'won', 'lost_confirmed', 'lost_inferred')),
  new_outcome  text NOT NULL CHECK (new_outcome  IN ('open', 'won', 'lost_confirmed', 'lost_inferred')),
  source       text NOT NULL CHECK (source IN ('rep', 'inferred')),
  changed_at   timestamptz NOT NULL DEFAULT now(),
  -- a logged row is an actual transition, never a no-op.
  CONSTRAINT client_outcome_history_is_transition_ck CHECK (prev_outcome <> new_outcome),
  CONSTRAINT client_outcome_history_user_id_client_id_fkey
    FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS client_outcome_history_user_id_idx ON client_outcome_history(user_id);
-- the per-client trail, oldest first.
CREATE INDEX IF NOT EXISTS client_outcome_history_client_id_changed_at_idx
  ON client_outcome_history(client_id, changed_at);

ALTER TABLE client_outcome_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_outcome_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_outcome_history_tenant_isolation ON client_outcome_history;
CREATE POLICY client_outcome_history_tenant_isolation ON client_outcome_history
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- Append-only: the app role may read and insert, but NEVER update or delete. Removal is by cascade only.
GRANT SELECT, INSERT ON client_outcome_history TO tovira_app;
