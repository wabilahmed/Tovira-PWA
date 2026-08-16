-- 0030_email_log.sql — idempotency ledger for lifecycle emails (one per event
-- per user). A replayed Stripe webhook or a re-run scheduler never double-sends.
CREATE TABLE IF NOT EXISTS email_log (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_key)
);
GRANT SELECT, INSERT, DELETE ON email_log TO tovira_app;
