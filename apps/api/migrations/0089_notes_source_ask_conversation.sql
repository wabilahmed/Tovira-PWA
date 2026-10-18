-- [P21-R1 / FEAT-06] Ask capture stores the rep's stated fact as a pending note with
-- source 'ask_conversation' (ASK-CAPTURE, Option A). notes_source_check (0020) still only allowed
-- voice/paste/whatsapp_export, so every capture INSERT was rejected on Postgres (the in-memory store has
-- no CHECK, so the suite never saw it) and Ask fell back to "I don't have that on record".
-- Widen the constraint; existing rows are unaffected (every stored source is already in the new list).
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_source_check;
ALTER TABLE notes ADD CONSTRAINT notes_source_check
  CHECK (source IN ('voice', 'paste', 'whatsapp_export', 'ask_conversation'));

-- Rollback (manual; only once no ask_conversation rows remain):
--   ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_source_check;
--   ALTER TABLE notes ADD CONSTRAINT notes_source_check CHECK (source IN ('voice', 'paste', 'whatsapp_export'));
