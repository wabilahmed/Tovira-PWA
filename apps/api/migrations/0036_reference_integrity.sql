-- 0036_reference_integrity.sql — make cross-tenant references UNREPRESENTABLE.
--
-- Defect (IDOR-DEAL-VALUE + a systemic gap): every child table referenced
-- clients(id) / notes(id) by the GLOBALLY-unique id alone. A row in tenant B could
-- therefore point at tenant A's client_id, and RLS never fired (the row's own
-- user_id was B's, which is what RLS checks). The handler guards were the only thing
-- stopping it — and one handler (deal-value) forgot.
--
-- Fix: give clients and notes a UNIQUE (user_id, id) key, then rewrite every child
-- FK as a COMPOSITE (user_id, <ref>_id) -> parent(user_id, id). Now a mismatched
-- (user_id, client_id) / (user_id, note_id) pair is a foreign-key violation at the
-- database, no matter what any handler forgets. Defensive DELETEs first remove any
-- pre-existing cross-tenant/orphan rows so the new constraints can be added.
--
-- Reference-integrity inventory (1c) — every tenant-owned reference, all now composite:
--   notes(user_id, client_id)             -> clients   [handler-guarded: yes]
--   promises(user_id, note_id/client_id)  -> notes/clients [server-written]
--   meetings(user_id, client_id)          -> clients   [handler-guarded: yes]
--   notifications(user_id, client_id?)    -> clients   [server-written; client_id nullable]
--   extraction_logs(user_id, note_id)     -> notes     [server-written]
--   corrections(user_id, note_id)         -> notes     [server-written]
--   images(user_id, client_id)            -> clients   [handler-guarded: yes]
--   key_dates(user_id, note_id/client_id) -> notes/clients [server-written]
--   ledger_events(user_id, client_id)     -> clients   [server-written]
--   client_deal_values(user_id,client_id) -> clients   [handler-guarded: NO -> fixed in 1a]

-- ---- Composite-unique targets on the parents (required to reference (user_id,id)) ----
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_user_id_id_key;
ALTER TABLE clients ADD  CONSTRAINT clients_user_id_id_key UNIQUE (user_id, id);
ALTER TABLE notes   DROP CONSTRAINT IF EXISTS notes_user_id_id_key;
ALTER TABLE notes   ADD  CONSTRAINT notes_user_id_id_key UNIQUE (user_id, id);

-- ---- notes -> clients ----
DELETE FROM notes n WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = n.user_id AND c.id = n.client_id);
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_client_id_fkey;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_user_id_client_id_fkey;
ALTER TABLE notes ADD  CONSTRAINT notes_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- promises -> notes + clients ----
DELETE FROM promises p WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.user_id = p.user_id AND n.id = p.note_id);
DELETE FROM promises p WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = p.user_id AND c.id = p.client_id);
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_note_id_fkey;
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_client_id_fkey;
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_user_id_note_id_fkey;
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_user_id_client_id_fkey;
ALTER TABLE promises ADD  CONSTRAINT promises_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;
ALTER TABLE promises ADD  CONSTRAINT promises_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- meetings -> clients ----
DELETE FROM meetings m WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = m.user_id AND c.id = m.client_id);
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_client_id_fkey;
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_user_id_client_id_fkey;
ALTER TABLE meetings ADD  CONSTRAINT meetings_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- notifications -> clients (client_id is nullable; MATCH SIMPLE skips NULLs) ----
DELETE FROM notifications x WHERE x.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = x.user_id AND c.id = x.client_id);
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_client_id_fkey;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_client_id_fkey;
ALTER TABLE notifications ADD  CONSTRAINT notifications_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- extraction_logs -> notes ----
DELETE FROM extraction_logs e WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.user_id = e.user_id AND n.id = e.note_id);
ALTER TABLE extraction_logs DROP CONSTRAINT IF EXISTS extraction_logs_note_id_fkey;
ALTER TABLE extraction_logs DROP CONSTRAINT IF EXISTS extraction_logs_user_id_note_id_fkey;
ALTER TABLE extraction_logs ADD  CONSTRAINT extraction_logs_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;

-- ---- corrections -> notes ----
DELETE FROM corrections r WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.user_id = r.user_id AND n.id = r.note_id);
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_note_id_fkey;
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_user_id_note_id_fkey;
ALTER TABLE corrections ADD  CONSTRAINT corrections_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;

-- ---- images -> clients ----
DELETE FROM images i WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = i.user_id AND c.id = i.client_id);
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_client_id_fkey;
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_user_id_client_id_fkey;
ALTER TABLE images ADD  CONSTRAINT images_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- key_dates -> notes + clients ----
DELETE FROM key_dates k WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.user_id = k.user_id AND n.id = k.note_id);
DELETE FROM key_dates k WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = k.user_id AND c.id = k.client_id);
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_note_id_fkey;
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_client_id_fkey;
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_user_id_note_id_fkey;
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_user_id_client_id_fkey;
ALTER TABLE key_dates ADD  CONSTRAINT key_dates_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;
ALTER TABLE key_dates ADD  CONSTRAINT key_dates_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- ledger_events -> clients ----
DELETE FROM ledger_events l WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = l.user_id AND c.id = l.client_id);
ALTER TABLE ledger_events DROP CONSTRAINT IF EXISTS ledger_events_client_id_fkey;
ALTER TABLE ledger_events DROP CONSTRAINT IF EXISTS ledger_events_user_id_client_id_fkey;
ALTER TABLE ledger_events ADD  CONSTRAINT ledger_events_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- client_deal_values -> clients (the table behind the reported IDOR) ----
DELETE FROM client_deal_values d WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = d.user_id AND c.id = d.client_id);
ALTER TABLE client_deal_values DROP CONSTRAINT IF EXISTS client_deal_values_client_id_fkey;
ALTER TABLE client_deal_values DROP CONSTRAINT IF EXISTS client_deal_values_user_id_client_id_fkey;
ALTER TABLE client_deal_values ADD  CONSTRAINT client_deal_values_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;
