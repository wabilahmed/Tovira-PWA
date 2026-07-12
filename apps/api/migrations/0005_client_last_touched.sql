-- 0005_client_last_touched.sql — recency for fast client selection (P1-2).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_touched_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS clients_last_touched_idx ON clients(user_id, last_touched_at DESC);
