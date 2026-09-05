-- INV-MATCH (A4b): persisted requirement↔inventory matches. A match is a SUGGESTION, never an
-- action — this table never causes a share, a disable, or a purchase. It exists to make dismissal
-- idempotent and to retain the similarity score for beta threshold calibration.
CREATE TABLE IF NOT EXISTS inventory_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  item_id uuid NOT NULL,
  client_id uuid NOT NULL,
  similarity double precision NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('strong', 'possible')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  -- Idempotency: one row per (rep, requirement, item). A dismissed pairing stays dismissed and
  -- cannot be re-created by the other match direction.
  UNIQUE (user_id, requirement_id, item_id),
  -- Isolation at the DB (0036 doctrine): every reference is composite (user_id, *_id), so a match
  -- can only ever join a requirement, an item and a client that ALL belong to the same rep. A
  -- cross-tenant pairing is a FK violation, not a handler check. ON DELETE CASCADE so a removed
  -- requirement/item/client takes its matches with it.
  CONSTRAINT inventory_matches_user_req_fk    FOREIGN KEY (user_id, requirement_id) REFERENCES requirements    (user_id, id) ON DELETE CASCADE,
  CONSTRAINT inventory_matches_user_item_fk   FOREIGN KEY (user_id, item_id)        REFERENCES inventory_items  (user_id, id) ON DELETE CASCADE,
  CONSTRAINT inventory_matches_user_client_fk FOREIGN KEY (user_id, client_id)      REFERENCES clients          (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS inventory_matches_client_idx ON inventory_matches (user_id, client_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS inventory_matches_item_idx   ON inventory_matches (user_id, item_id)   WHERE status = 'open';

ALTER TABLE inventory_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_matches_tenant ON inventory_matches;
CREATE POLICY inventory_matches_tenant ON inventory_matches
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
