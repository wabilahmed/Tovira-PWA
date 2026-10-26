-- 0101_hot_lead_tombstones.sql — [P46-6c.4] A lead erased at Explee (the person asked to be removed) is never imported
-- again by a later poll. Only person_id + campaign_id are kept, no personal fields. OWNER pool only (never granted to
-- tovira_app); listed in the GRANT-LINT OWNER_PLANE and RLS_EXEMPT allowlists.
CREATE TABLE IF NOT EXISTS hot_lead_tombstones (
  person_id   text NOT NULL,
  campaign_id integer NOT NULL,
  erased_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, campaign_id)
);

-- Leads already wiped under P45 (kept as an erased row): keep only the tombstone, drop the row.
INSERT INTO hot_lead_tombstones (person_id, campaign_id, erased_at)
  SELECT person_id, campaign_id, updated_at FROM hot_leads WHERE erased
  ON CONFLICT DO NOTHING;
DELETE FROM hot_leads WHERE erased;
