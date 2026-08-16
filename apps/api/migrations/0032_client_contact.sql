-- 0032_client_contact.sql — persist a business card's title + email on the
-- client (P4-5), so a scanned contact isn't reduced to name+phone. Stored
-- verbatim, never guessed.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email text;
