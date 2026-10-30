-- 0109_admin_event_backfill.sql — [P60 · owner] The admin hears once per person about their first sign-in and their
-- first chat import or voice note (email_log keys 'admin.first_sign_in' / 'admin.first_capture'). Everyone already
-- using Tovira is marked as already told, so no one gets a late "first" email for something they did weeks ago:
--  * first capture: anyone with a voice note or an imported chat
--  * first sign-in: every account except an invited one that has not been activated yet (its invite still unused)
INSERT INTO email_log (user_id, event_key)
  SELECT DISTINCT user_id, 'admin.first_capture' FROM notes WHERE source IN ('voice', 'whatsapp_export')
  ON CONFLICT DO NOTHING;
INSERT INTO email_log (user_id, event_key)
  SELECT u.id, 'admin.first_sign_in' FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM invites i WHERE i.user_id = u.id AND i.consumed_at IS NULL)
  ON CONFLICT DO NOTHING;
