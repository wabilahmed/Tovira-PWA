-- [SPEND-INSTRUMENT] Durable per-call model-spend event log. ALONGSIDE spend_ledger (which aggregates
-- AED-by-class for the cap): this keeps the token breakdown + cache outcome per call, so "what did each
-- feature cost" is answerable from data after a pilot month, and a per-model total is directly comparable
-- to an Anthropic invoice for the same period. Cross-tenant cost accounting for OPS — NO RLS (reads
-- aggregate across accounts behind the ops token). System calls (canary) have user_id / period_key NULL.
CREATE TABLE IF NOT EXISTS model_call_events (
  id                    bigserial PRIMARY KEY,
  user_id               text,               -- NULL = system call, charged to no account
  period_key            text,               -- rep billing bucket (periodKeyFrom); NULL for system
  spend_class           text NOT NULL,      -- one of SPEND_CLASSES (validated in code, closed set)
  model                 text NOT NULL,
  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  thinking_tokens       integer NOT NULL DEFAULT 0,
  cache_read_tokens     integer NOT NULL DEFAULT 0,
  cache_creation_tokens integer NOT NULL DEFAULT 0,
  cache_hit             boolean NOT NULL DEFAULT false,
  cost_aed              double precision NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_call_events_period ON model_call_events (period_key);
CREATE INDEX IF NOT EXISTS model_call_events_user_period ON model_call_events (user_id, period_key);
-- The app role inserts one row per metered call; ops reads via the root pool.
GRANT SELECT, INSERT ON model_call_events TO tovira_app;
GRANT USAGE, SELECT ON SEQUENCE model_call_events_id_seq TO tovira_app;
