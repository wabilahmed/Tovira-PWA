-- [SPEND-CAP] Ops-facing alerts (e.g. a rep crossing 80% of the spend cap). Cross-tenant, written
-- on the superuser pool and surfaced on /health — NOT a rep's tenant data, so no RLS. Idempotent
-- per (kind, dedupe_key): one alert per rep per period, not one per call over the line.
CREATE TABLE IF NOT EXISTS ops_alerts (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind       text NOT NULL,
  user_id    text NOT NULL,
  dedupe_key text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS ops_alerts_created_idx ON ops_alerts (created_at DESC);
