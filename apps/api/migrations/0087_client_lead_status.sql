-- 0087_client_lead_status.sql [LEAD-STATUS] — a rep's MANUAL pipeline label per client.
--
-- Distinct from `outcome` (0061): outcome is how a deal ENDED (won / lost) and may be set AUTOMATICALLY
-- by the nightly silence rule (source='inferred'); lead_status is set ONLY by a rep tapping a status,
-- NEVER automatically — not by extraction, import, the going-cold signals, pointers or the
-- retrospective. NULL means "Unsorted", the default for every new and imported client.
--
-- Isolation: `clients` already has RLS ENABLE + FORCE + the tenant-isolation policy (0003) and the
-- composite UNIQUE (user_id, id) key (0036). New columns inherit that policy automatically — a client's
-- lead_status is readable/writable ONLY by its owner, enforced at the DB, not just in app code.

ALTER TABLE clients
  -- NULL (Unsorted) is allowed: a CHECK passes when its expression is NULL, so this permits
  -- NULL + the three explicit statuses and nothing else.
  ADD COLUMN IF NOT EXISTS lead_status text
    CHECK (lead_status IN ('warm', 'cold', 'done')),
  ADD COLUMN IF NOT EXISTS lead_status_changed_at timestamptz;

-- The clients-list filter counts and filters by lead_status per tenant.
CREATE INDEX IF NOT EXISTS clients_user_id_lead_status_idx ON clients(user_id, lead_status);
