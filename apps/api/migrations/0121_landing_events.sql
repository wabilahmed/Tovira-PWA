-- 0121_landing_events.sql — [P89 · owner, Prompt 86] Does the new landing scene work? Three more cookieless events on
-- game_events (the same owner-plane table and rules as 0116: no IP, no visitor hash, no user, nothing typed): scene_beat
-- (the beat reached, 1 to 5), start_click (which Start free: the beat or section it sits in) and game_banner. Every event
-- may carry the page's route: the landing or one of the seven game pages (NULL for a page cached from before P89).
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS route text CHECK (route IN ('/', '/game', '/game/property', '/game/insurance', '/game/wealth', '/game/b2b', '/game/luxury', '/game/recruitment'));
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS beat smallint CHECK (beat BETWEEN 1 AND 5);
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS place text CHECK (place IN ('header', 'beat1', 'beat5', 'pricing', 'closing', 'game_close'));
ALTER TABLE game_events DROP CONSTRAINT IF EXISTS game_events_event_check;
ALTER TABLE game_events ADD CONSTRAINT game_events_event_check CHECK (event IN ('game_view', 'game_start', 'chat_done', 'game_done', 'game_cta', 'game_replay', 'game_switch', 'game_signup', 'scene_beat', 'start_click', 'game_banner'));
