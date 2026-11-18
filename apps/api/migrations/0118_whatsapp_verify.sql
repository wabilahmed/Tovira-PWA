-- 0118_whatsapp_verify.sql — [P75 · owner] Beta request: capture the WhatsApp number, verify it after approval.
--   access_requests.whatsapp_e164  the number from the request form, E.164 (NULL on older requests and hot-lead ones).
--                                  It only pre-fills the verify step: nothing is linked until a code arrives from it.
--   whatsapp_link_confirms         a link code that arrived from a DIFFERENT number than the one the rep entered: the
--                                  number it came from, waiting (15 minutes) for the rep to confirm it in the app. Only
--                                  this number can then be linked; one row per rep; deleted with the user.
-- Like the P67 tables it is read by the signature-checked webhook before any tenant is known, so not tenant-RLS.
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS whatsapp_e164 text;
DO $$ BEGIN
  ALTER TABLE access_requests ADD CONSTRAINT access_requests_whatsapp_e164_format CHECK (whatsapp_e164 IS NULL OR whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS whatsapp_link_confirms (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL,
  wa_user_id  text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_link_codes_code_hash ON whatsapp_link_codes (code_hash);
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_link_confirms TO tovira_app;
