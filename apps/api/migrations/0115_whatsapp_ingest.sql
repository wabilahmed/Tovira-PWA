-- 0115_whatsapp_ingest.sql — [P67 · owner] Send a chat export to Tovira's WhatsApp number (built dark, behind
-- WHATSAPP_INGEST_ENABLED). Three small tables, none holding message content:
--   whatsapp_links       one linked WhatsApp number per rep (a number links to one account only); deleted with the user
--   whatsapp_link_codes  the rep's one pending link code, hashed, 15 minutes, single use; deleted with the user
--   whatsapp_inbound     Meta message ids already handled (Meta retries for up to 7 days), so one is never handled twice
-- Read by the unauthenticated, signature-checked webhook before any tenant is known, so not tenant-RLS (RLS_EXEMPT).
CREATE TABLE IF NOT EXISTS whatsapp_links (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL UNIQUE,
  wa_user_id  text UNIQUE,
  linked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_link_codes_phone ON whatsapp_link_codes (phone_e164);
CREATE TABLE IF NOT EXISTS whatsapp_inbound (
  message_id  text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_links, whatsapp_link_codes, whatsapp_inbound TO tovira_app;
