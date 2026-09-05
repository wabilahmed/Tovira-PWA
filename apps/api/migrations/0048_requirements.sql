-- INV-MATCH (A4): the requirements spine. What a client has STATED they are looking for, written
-- by extraction as first-class rows (like promises/key_dates) so requirements have identity (for
-- idempotent match dismissals), their OWN embedding (precise matching, not a blended note vector —
-- §4 precision over everything), and lifecycle state (§11.1: open → met, or dormant after 60 days).
CREATE TABLE IF NOT EXISTS requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  note_id uuid NOT NULL,
  client_id uuid NOT NULL,
  text text NOT NULL,
  requirement_raw text NOT NULL,
  stated_on date,
  confidence text NOT NULL CHECK (confidence IN ('high', 'low')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'met', 'dormant')),
  embedding vector(512),
  last_mentioned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Composite-unique so children (inventory matches) can reference (user_id, id) per the IDOR fix.
  UNIQUE (user_id, id),
  -- Isolation at the DB (0036 doctrine): a cross-tenant / cross-client reference is a FK violation,
  -- not a handler check. A moved note's requirements have their client_id updated in the same
  -- transaction (NoteMoveTx); an undone/deleted note cascades its requirements away.
  CONSTRAINT requirements_user_client_fk FOREIGN KEY (user_id, client_id) REFERENCES clients (user_id, id) ON DELETE CASCADE,
  CONSTRAINT requirements_user_note_fk   FOREIGN KEY (user_id, note_id)   REFERENCES notes   (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS requirements_user_idx ON requirements (user_id);
CREATE INDEX IF NOT EXISTS requirements_client_idx ON requirements (user_id, client_id);
-- Open requirements are the matchable set (reverse direction + dormancy sweep); partial index keeps
-- those scans cheap.
CREATE INDEX IF NOT EXISTS requirements_open_idx ON requirements (user_id) WHERE status = 'open';

ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS requirements_tenant ON requirements;
CREATE POLICY requirements_tenant ON requirements
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
