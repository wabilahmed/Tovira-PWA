-- 0116_game_events.sql — [P71-T · owner] Cookieless counts for the landing page game, the same rules as the P63 visits
-- (0112): OWNER pool only (never granted to tovira_app), no IP, no visitor hash, no user, nothing typed. One row per
-- action: the event, the day, and only the fields that event carries (industry; chat number, details caught, details
-- in the chat and whether a wrong tap ended it; the score bucket). Read only by Admin → Funnel's game funnel.
CREATE TABLE IF NOT EXISTS game_events (
  id         bigserial PRIMARY KEY,
  day        date NOT NULL,
  event      text NOT NULL CHECK (event IN ('game_view', 'game_start', 'chat_done', 'game_done', 'game_cta', 'game_replay', 'game_switch', 'game_signup')),
  industry   text CHECK (industry IN ('Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment')),
  chat       smallint CHECK (chat BETWEEN 1 AND 5),
  caught     smallint CHECK (caught BETWEEN 0 AND 4),
  details    smallint CHECK (details BETWEEN 1 AND 4),
  wrong      boolean,
  bucket     text CHECK (bucket IN ('0-3', '4-6', '7-9', '10-11', '12')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_events_day ON game_events (day);
