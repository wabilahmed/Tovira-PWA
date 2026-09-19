-- 0066_erasure.sql [ERASURE] — single-counterparty erasure (Privacy Policy §10 / Terms 4.9).
-- Two tenant tables:
--   erasure_requests: a pending third-party erasure + its Terms-4.9 retention window (rep may assert
--     a legal basis to retain until window_ends_at). requester_names is REQUEST metadata (who asked),
--     needed to run the window and prove the request was honoured — NOT erased fact content.
--   erasure_audit: an immutable record THAT an erasure ran — when, for whom, and category counts.
--     NEVER the erased content itself. categories is a JSONB array of {category, deleted}.
-- Both RLS-scoped like every tenant table and purged on account deletion via the users FK cascade.

CREATE TABLE IF NOT EXISTS erasure_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_names text[] NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  window_ends_at  timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending' -- pending | retention_asserted | completed
);
CREATE INDEX IF NOT EXISTS erasure_requests_user_idx ON erasure_requests (user_id);

CREATE TABLE IF NOT EXISTS erasure_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_names text[] NOT NULL,
  categories      jsonb NOT NULL DEFAULT '[]'::jsonb,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erasure_audit_user_idx ON erasure_audit (user_id);

ALTER TABLE erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE erasure_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erasure_requests_tenant_isolation ON erasure_requests;
CREATE POLICY erasure_requests_tenant_isolation ON erasure_requests
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON erasure_requests TO tovira_app;

ALTER TABLE erasure_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE erasure_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erasure_audit_tenant_isolation ON erasure_audit;
CREATE POLICY erasure_audit_tenant_isolation ON erasure_audit
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
GRANT SELECT, INSERT ON erasure_audit TO tovira_app;
