-- 0100_ledger_entries.sql — [P46-5] The Ledger as "the record of what Tovira helped you win".
-- 1. A share made from a Tovira suggestion remembers WHICH suggestion, so a Ledger entry shows the client's words that
--    led to it (its receipt) exactly. Null for an independent share and for shares made before this migration.
--    ON DELETE SET NULL (match_id) only: the share and its tenant stay (Postgres 15+; prod is 16).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_matches_user_id_id_key') THEN
    ALTER TABLE inventory_matches ADD CONSTRAINT inventory_matches_user_id_id_key UNIQUE (user_id, id);
  END IF;
END $$;
ALTER TABLE inventory_shares ADD COLUMN IF NOT EXISTS match_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_shares_user_match_fk') THEN
    ALTER TABLE inventory_shares ADD CONSTRAINT inventory_shares_user_match_fk
      FOREIGN KEY (user_id, match_id) REFERENCES inventory_matches (user_id, id) ON DELETE SET NULL (match_id);
  END IF;
END $$;

-- 2. The deal value lives on the entry (edited inline on its card). Never estimated: null until the rep enters it.
ALTER TABLE ledger_events ADD COLUMN IF NOT EXISTS deal_value_aed numeric;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_events_deal_value_nonneg') THEN
    ALTER TABLE ledger_events ADD CONSTRAINT ledger_events_deal_value_nonneg CHECK (deal_value_aed IS NULL OR deal_value_aed >= 0);
  END IF;
END $$;

-- 3. Carry over a value the rep already entered per client, ONLY where that client has exactly one suggested sale (so
--    the value belongs to that deal without a guess). Any other per-client value stays in client_deal_values, unused.
UPDATE ledger_events e
   SET deal_value_aed = d.aed
  FROM client_deal_values d
 WHERE e.user_id = d.user_id AND e.client_id = d.client_id
   AND e.type = 'inventory_suggested_bought' AND e.deal_value_aed IS NULL
   AND (SELECT count(*) FROM ledger_events x
         WHERE x.user_id = e.user_id AND x.client_id = e.client_id AND x.type = 'inventory_suggested_bought') = 1;
