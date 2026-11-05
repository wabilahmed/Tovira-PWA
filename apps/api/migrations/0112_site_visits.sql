-- 0112_site_visits.sql — [P63-7 · owner] Cookieless, first-party site visits for Admin → Funnel. OWNER pool only (never
-- granted to tovira_app). No IP is ever stored. A visitor is a hash of IP + user agent + that day's random salt; the
-- salt lives only for its day (visit_salts) and each day's hashes are cleared once the day is over (its counts move to
-- visit_days). visit_excluded holds a signed-in admin's hash for the day so their own visits don't count.
CREATE TABLE IF NOT EXISTS page_views (
  id              bigserial PRIMARY KEY,
  day             date NOT NULL,
  page            text NOT NULL CHECK (page IN ('landing', 'request_access', 'sign_in', 'privacy', 'submitted')),
  referrer_domain text,
  utm_source      text,
  utm_campaign    text,
  device          text NOT NULL CHECK (device IN ('phone', 'desktop')),
  visitor_hash    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS page_views_day ON page_views (day);
CREATE TABLE IF NOT EXISTS visit_salts (day date PRIMARY KEY, salt text NOT NULL);
CREATE TABLE IF NOT EXISTS visit_excluded (day date NOT NULL, visitor_hash text NOT NULL, PRIMARY KEY (day, visitor_hash));
CREATE TABLE IF NOT EXISTS visit_days (
  day             date PRIMARY KEY,
  views           integer NOT NULL,
  uniques         integer NOT NULL,
  landing_uniques integer NOT NULL,
  reached_request integer NOT NULL,
  submitted       integer NOT NULL
);
