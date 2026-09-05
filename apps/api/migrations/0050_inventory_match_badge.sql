-- INV-MATCH surfacing (A5): the Inventory-tab badge's seen-tracking — one timestamp per rep. The
-- badge counts STRONG, OPEN matches created after this instant; opening the tab bumps it. A count of
-- things waiting is not a claim about a client, so it carries no receipt (the surface it opens does).
CREATE TABLE IF NOT EXISTS inventory_match_badge_views (
  user_id uuid PRIMARY KEY,
  last_viewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_match_badge_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_match_badge_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_match_badge_views_tenant ON inventory_match_badge_views;
CREATE POLICY inventory_match_badge_views_tenant ON inventory_match_badge_views
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
