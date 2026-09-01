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
-- database, no matter what any handler forgets.
--
-- 1b-i: a composite FK cannot be added while a violating row exists. The QA harness
-- wrote a cross-tenant row during the run (B's deal value -> A's client); its accounts
-- were then deleted, which CASCADE-removed those rows, so the expected count below is
-- ~0. The DO block finds, COUNTS, reports (RAISE NOTICE, visible in the migrate log),
-- and removes any orphaned/cross-tenant reference so the constraints can be added.
-- ANY non-zero count beyond the harness's own rows means the endpoint was exercised in
-- the wild before the guard — treat that as a separate finding and investigate.
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

-- The migration runs as the tables' owner, but on RDS that role is NOT a superuser
-- and lacks BYPASSRLS, so FORCE ROW LEVEL SECURITY applies to it too — with no
-- app.user_id set, the cleanup DELETEs below would match ZERO rows and silently fail
-- to remove a violating reference, making the composite FK ADD fail. Lift FORCE for
-- the owner across the cleanup (RLS stays ENABLED, so the app role tovira_app is still
-- isolated), then restore FORCE at the end. The whole migration is one transaction.
ALTER TABLE clients            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notes              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE promises           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE meetings           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE extraction_logs    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE corrections        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE images             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE key_dates          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_events      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE client_deal_values NO FORCE ROW LEVEL SECURITY;

-- ---- 1b-i: find, COUNT, report, and remove orphaned cross-tenant references ----
DO $$
DECLARE
  n integer;
  total integer := 0;
  tag text := '[0036] reference-integrity';
BEGIN
  DELETE FROM notes t WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned notes -> clients', tag, n; END IF;

  DELETE FROM promises t WHERE NOT EXISTS (SELECT 1 FROM notes p WHERE p.user_id = t.user_id AND p.id = t.note_id)
                            OR NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned promises', tag, n; END IF;

  DELETE FROM meetings t WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned meetings', tag, n; END IF;

  DELETE FROM notifications t WHERE t.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned notifications', tag, n; END IF;

  DELETE FROM extraction_logs t WHERE NOT EXISTS (SELECT 1 FROM notes p WHERE p.user_id = t.user_id AND p.id = t.note_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned extraction_logs', tag, n; END IF;

  DELETE FROM corrections t WHERE NOT EXISTS (SELECT 1 FROM notes p WHERE p.user_id = t.user_id AND p.id = t.note_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned corrections', tag, n; END IF;

  DELETE FROM images t WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned images', tag, n; END IF;

  DELETE FROM key_dates t WHERE NOT EXISTS (SELECT 1 FROM notes p WHERE p.user_id = t.user_id AND p.id = t.note_id)
                            OR NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned key_dates', tag, n; END IF;

  DELETE FROM ledger_events t WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned ledger_events', tag, n; END IF;

  DELETE FROM client_deal_values t WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.user_id = t.user_id AND c.id = t.client_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; IF n > 0 THEN RAISE NOTICE '% : % orphaned client_deal_values (the reported IDOR''s table)', tag, n; END IF;

  RAISE NOTICE '% : % orphaned cross-tenant/dangling reference row(s) removed in total', tag, total;
  IF total > 0 THEN
    RAISE NOTICE '% : any count beyond the QA harness rows (already CASCADE-removed by teardown) means the endpoint was exercised in the wild — investigate as a separate finding', tag;
  END IF;
END $$;

-- ---- Composite-unique targets on the parents (required to reference (user_id,id)) ----
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_user_id_id_key;
ALTER TABLE clients ADD  CONSTRAINT clients_user_id_id_key UNIQUE (user_id, id);
ALTER TABLE notes   DROP CONSTRAINT IF EXISTS notes_user_id_id_key;
ALTER TABLE notes   ADD  CONSTRAINT notes_user_id_id_key UNIQUE (user_id, id);

-- ---- notes -> clients ----
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_client_id_fkey;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_user_id_client_id_fkey;
ALTER TABLE notes ADD  CONSTRAINT notes_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- promises -> notes + clients ----
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_note_id_fkey;
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_client_id_fkey;
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_user_id_note_id_fkey;
ALTER TABLE promises DROP CONSTRAINT IF EXISTS promises_user_id_client_id_fkey;
ALTER TABLE promises ADD  CONSTRAINT promises_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;
ALTER TABLE promises ADD  CONSTRAINT promises_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- meetings -> clients ----
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_client_id_fkey;
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_user_id_client_id_fkey;
ALTER TABLE meetings ADD  CONSTRAINT meetings_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- notifications -> clients (client_id nullable; MATCH SIMPLE skips NULLs) ----
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_client_id_fkey;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_client_id_fkey;
ALTER TABLE notifications ADD  CONSTRAINT notifications_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- extraction_logs -> notes ----
ALTER TABLE extraction_logs DROP CONSTRAINT IF EXISTS extraction_logs_note_id_fkey;
ALTER TABLE extraction_logs DROP CONSTRAINT IF EXISTS extraction_logs_user_id_note_id_fkey;
ALTER TABLE extraction_logs ADD  CONSTRAINT extraction_logs_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;

-- ---- corrections -> notes ----
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_note_id_fkey;
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_user_id_note_id_fkey;
ALTER TABLE corrections ADD  CONSTRAINT corrections_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;

-- ---- images -> clients ----
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_client_id_fkey;
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_user_id_client_id_fkey;
ALTER TABLE images ADD  CONSTRAINT images_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- key_dates -> notes + clients ----
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_note_id_fkey;
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_client_id_fkey;
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_user_id_note_id_fkey;
ALTER TABLE key_dates DROP CONSTRAINT IF EXISTS key_dates_user_id_client_id_fkey;
ALTER TABLE key_dates ADD  CONSTRAINT key_dates_user_id_note_id_fkey
  FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE;
ALTER TABLE key_dates ADD  CONSTRAINT key_dates_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- ledger_events -> clients ----
ALTER TABLE ledger_events DROP CONSTRAINT IF EXISTS ledger_events_client_id_fkey;
ALTER TABLE ledger_events DROP CONSTRAINT IF EXISTS ledger_events_user_id_client_id_fkey;
ALTER TABLE ledger_events ADD  CONSTRAINT ledger_events_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- client_deal_values -> clients (the table behind the reported IDOR) ----
ALTER TABLE client_deal_values DROP CONSTRAINT IF EXISTS client_deal_values_client_id_fkey;
ALTER TABLE client_deal_values DROP CONSTRAINT IF EXISTS client_deal_values_user_id_client_id_fkey;
ALTER TABLE client_deal_values ADD  CONSTRAINT client_deal_values_user_id_client_id_fkey
  FOREIGN KEY (user_id, client_id) REFERENCES clients(user_id, id) ON DELETE CASCADE;

-- ---- Restore FORCE ROW LEVEL SECURITY on every table we lifted it from ----
ALTER TABLE clients            FORCE ROW LEVEL SECURITY;
ALTER TABLE notes              FORCE ROW LEVEL SECURITY;
ALTER TABLE promises           FORCE ROW LEVEL SECURITY;
ALTER TABLE meetings           FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications      FORCE ROW LEVEL SECURITY;
ALTER TABLE extraction_logs    FORCE ROW LEVEL SECURITY;
ALTER TABLE corrections        FORCE ROW LEVEL SECURITY;
ALTER TABLE images             FORCE ROW LEVEL SECURITY;
ALTER TABLE key_dates          FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_events      FORCE ROW LEVEL SECURITY;
ALTER TABLE client_deal_values FORCE ROW LEVEL SECURITY;
