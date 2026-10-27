-- 0104_person_link_questions.sql — [P50-2] "Is 'Khalid' in this chat the same person as Khalid Al Mansoori?"
--
-- Since P50 a person folds into a client only on an exact full-name match. A person who only SHARES A WORD with the
-- client's name or an alias stays their own entry, and the rep is asked once (Needs your answer):
--   same       → their entries fold into the client, and the name is kept as a rep-confirmed alias (exact match only);
--   different  → they stay separate, and Tovira never asks about that pair again.
-- One row per (client, person) pair: the unique key is what makes "never ask again" hold. quote/quote_at are the receipt
-- the card shows (where the name appears), so the rep can see why Tovira is asking.
--
-- Isolation as clients: RLS ENABLE + FORCE + tenant policy, composite FK (user_id, client_id) -> clients. The app role
-- may read, insert and update (the answer); rows go by cascade (a client or account deleted).

CREATE TABLE IF NOT EXISTS person_link_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL,
  note_id      uuid NULL,
  person_name  text NOT NULL,
  person_key   text NOT NULL,
  quote        text NULL,
  quote_at     text NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'same', 'different')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz NULL,
  CONSTRAINT person_link_questions_one_per_pair UNIQUE (user_id, client_id, person_key),
  CONSTRAINT person_link_questions_user_id_client_id_fkey
    FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS person_link_questions_user_status_idx ON person_link_questions(user_id, status);

ALTER TABLE person_link_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_link_questions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS person_link_questions_tenant_isolation ON person_link_questions;
CREATE POLICY person_link_questions_tenant_isolation ON person_link_questions
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON person_link_questions TO tovira_app;

-- A rep-confirmed alias ("Same person"): folds on the exact name only, like every alias since P50.
ALTER TABLE client_aliases DROP CONSTRAINT IF EXISTS client_aliases_kind_ck;
ALTER TABLE client_aliases ADD CONSTRAINT client_aliases_kind_ck CHECK (kind IN ('learned', 'previous_name', 'rep_confirmed'));
