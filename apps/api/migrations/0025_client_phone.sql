-- 0025_client_phone.sql — P4-7: an optional contact phone on each client.
-- Stored as the rep entered it (we never rewrite it or guess a country code);
-- used to target the WhatsApp deep link. RLS already scopes the clients table,
-- so the phone is tenant-isolated like every other column.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone text;
