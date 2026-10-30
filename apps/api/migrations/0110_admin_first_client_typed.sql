-- 0110_admin_first_client_typed.sql — [P61-7 · owner] The admin's "first client" email now counts a typed note too (it
-- counted only a chat import or a voice note, 0109). Everyone who already has a typed note is marked as already told, so
-- no one gets a late "added their first client" for a note typed weeks ago.
INSERT INTO email_log (user_id, event_key)
  SELECT DISTINCT user_id, 'admin.first_capture' FROM notes WHERE source = 'paste'
  ON CONFLICT DO NOTHING;
