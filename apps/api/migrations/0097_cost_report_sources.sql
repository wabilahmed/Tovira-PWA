-- 0097_cost_report_sources.sql — [P44-2] The ops cost report's two missing sources. Both are cross-tenant cost
-- accounting for OPS, like model_call_events: written system-side, read only behind the ops token, never a rep
-- query path (no RLS; listed in the RLS-exempt allowlist). Append-only: the app role may only INSERT and SELECT.
--
-- transcription_events: one row per completed voice-note transcription, so the Groq cost can be worked out from
-- audio seconds per user and billing period. Earlier voice notes have no row (their seconds were never kept).
CREATE TABLE IF NOT EXISTS transcription_events (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL,
  period_key    text,                         -- the rep's billing-period key at the time (as Claude spend)
  model         text NOT NULL,
  audio_seconds double precision NOT NULL CHECK (audio_seconds >= 0),
  estimated     boolean NOT NULL DEFAULT false, -- true = from the recording's byte length (no provider duration)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transcription_events_user_period ON transcription_events (user_id, period_key);
CREATE INDEX IF NOT EXISTS transcription_events_created ON transcription_events (created_at);
GRANT SELECT, INSERT ON transcription_events TO tovira_app;
GRANT USAGE, SELECT ON SEQUENCE transcription_events_id_seq TO tovira_app;

-- revenue_events: one row per paid Stripe object, keyed by its Stripe id (a replayed webhook is a no-op): a paid
-- subscription invoice (period = the invoice line's period) or a paid top-up Checkout session (the rep's period at
-- payment). The amount is what Stripe says was paid, in its smallest unit.
CREATE TABLE IF NOT EXISTS revenue_events (
  stripe_id   text PRIMARY KEY,
  user_id     text,
  kind        text NOT NULL CHECK (kind IN ('subscription', 'topup')),
  amount_fils bigint NOT NULL CHECK (amount_fils >= 0),
  currency    text NOT NULL,
  paid_at     timestamptz NOT NULL,
  period_key  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revenue_events_user_period ON revenue_events (user_id, period_key);
GRANT SELECT, INSERT ON revenue_events TO tovira_app;
