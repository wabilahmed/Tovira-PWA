-- 0041_inventory.sql — the inventory store (feat(INVENTORY-1), spec §3).
-- What the rep has to sell: a generic title/description/quantity list, embedded on
-- save so Batch 2's matching has data waiting. Two tenant-isolated tables. Isolation
-- is enforced at the DB (RLS + FORCE) AND cross-tenant references are composite-FK
-- violations, not handler checks — the IDOR fix applied at design time (see 0036).

CREATE TABLE IF NOT EXISTS inventory_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text NOT NULL,
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- why it is off, so the rep can tell "I sold through it" from "I took it down".
  disabled_reason text CHECK (disabled_reason IN ('sold_out', 'unlisted')),
  embedding       vector(512),   -- from title + description (Bedrock Titan v2, dim 512)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- an active item is never mid-disable without a reason, and a disabled one always has one.
  CONSTRAINT inventory_items_disabled_reason_ck
    CHECK ((status = 'disabled') = (disabled_reason IS NOT NULL)),
  -- required for the composite FK from inventory_shares (the IDOR net).
  CONSTRAINT inventory_items_user_id_id_key UNIQUE (user_id, id)
);
CREATE INDEX IF NOT EXISTS inventory_items_user_id_idx ON inventory_items(user_id);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_items_tenant_isolation ON inventory_items;
CREATE POLICY inventory_items_tenant_isolation ON inventory_items
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_items TO tovira_app;

CREATE TABLE IF NOT EXISTS inventory_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL,
  client_id       uuid NOT NULL,
  shared_at       timestamptz NOT NULL DEFAULT now(),
  outcome         text NOT NULL DEFAULT 'pending'
                    CHECK (outcome IN ('pending', 'bought', 'declined', 'no_response')),
  outcome_set_by  text CHECK (outcome_set_by IN ('rep', 'confirmed_suggestion')),
  quantity_bought integer CHECK (quantity_bought IS NULL OR quantity_bought >= 0),
  -- Cross-tenant references are DB errors, not handler checks (IDOR fix, 0036):
  -- the (user_id, item_id) / (user_id, client_id) pairs must resolve within one tenant.
  CONSTRAINT inventory_shares_user_id_item_id_fkey
    FOREIGN KEY (user_id, item_id) REFERENCES inventory_items(user_id, id) ON DELETE CASCADE,
  CONSTRAINT inventory_shares_user_id_client_id_fkey
    FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS inventory_shares_user_id_idx ON inventory_shares(user_id);
CREATE INDEX IF NOT EXISTS inventory_shares_item_id_idx ON inventory_shares(item_id);
CREATE INDEX IF NOT EXISTS inventory_shares_client_id_idx ON inventory_shares(client_id);

ALTER TABLE inventory_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_shares_tenant_isolation ON inventory_shares;
CREATE POLICY inventory_shares_tenant_isolation ON inventory_shares
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_shares TO tovira_app;
