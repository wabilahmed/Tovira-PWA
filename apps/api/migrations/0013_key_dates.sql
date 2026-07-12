-- 0013_key_dates.sql — the key-dates spine (P3-4 reminders). RLS.
CREATE TABLE IF NOT EXISTS key_dates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id     uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  description text NOT NULL,
  date        date,
  date_raw    text,
  type        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS key_dates_user_id_idx ON key_dates(user_id);

ALTER TABLE key_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_dates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS key_dates_tenant_isolation ON key_dates;
CREATE POLICY key_dates_tenant_isolation ON key_dates
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON key_dates TO tovira_app;
