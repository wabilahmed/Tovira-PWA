-- 0059_missing_grants.sql — fix a cluster of the 0037 class. The requirements /
-- inventory-matching / note-move-audit feature migrations (0047-0050) each CREATEd
-- a table but omitted the `GRANT ... TO tovira_app` that every app-plane table
-- carries. The migration runs as the owner so the tables exist and the schema
-- audit passes, but at runtime the API connects as the non-owner role tovira_app:
--   - inventory_matches → "permission denied" broke `priorities-nightly` outright
--     (visible on /health) and 500'd /today on every cache miss (hero.today reads
--     open matches before the ranking model call — so no runaway spend, but a hard
--     failure, not the cheap cached path the cost-guard intends).
--   - requirements / note_move_audit / inventory_match_badge_views were LATENT: they
--     fail only on a real requirement extraction, a real note move, or a badge read
--     — invisible to the in-memory suite, exactly like referrals in 0037.
-- Privileges match what each adapter actually issues (least privilege):
GRANT SELECT, INSERT, UPDATE, DELETE ON requirements                 TO tovira_app; -- insert/read/status-update/delete
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_matches            TO tovira_app; -- create/read/dismiss(update); cascade cleanup
GRANT SELECT, INSERT, UPDATE          ON inventory_match_badge_views TO tovira_app; -- upsert (INSERT ... ON CONFLICT DO UPDATE) + read
GRANT SELECT, INSERT                   ON note_move_audit            TO tovira_app; -- append-only audit trail: never updated/deleted by the app (cf. invoice_tax)
