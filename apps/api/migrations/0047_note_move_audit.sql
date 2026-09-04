-- NOTE-MOVE / IMPORT-UNDO (B3/B4): an audit trail for moving a note between clients or undoing an
-- import. A move/undo rewrites which client owns a note and everything derived from it, so it must
-- be recorded rather than silently rewriting history.
--
-- note_id deliberately has NO foreign key to notes: an undo DELETEs the note, and the audit row
-- must survive that (same reasoning as the extraction log in 0045). from/to client ids are plain
-- uuids for the same reason (a client could later be removed).
CREATE TABLE IF NOT EXISTS note_move_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  note_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('move', 'undo')),
  from_client_id uuid,
  to_client_id uuid,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_move_audit_user_idx ON note_move_audit (user_id, occurred_at DESC);

-- Tenant isolation: a rep sees only their own audit rows (same policy shape as every other table).
ALTER TABLE note_move_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_move_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS note_move_audit_tenant ON note_move_audit;
CREATE POLICY note_move_audit_tenant ON note_move_audit
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
