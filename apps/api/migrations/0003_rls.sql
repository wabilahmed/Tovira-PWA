-- 0003_rls.sql — tenant isolation via Postgres Row-Level Security (P0-4).
--
-- The API connects at runtime as `tovira_app`, a NON-superuser role, so RLS is
-- always enforced (superusers bypass RLS — that's why the app must not be one).
-- Migrations run as the superuser/owner. Locally the role is created here; in
-- prod it is provisioned by infra and this block is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tovira_app') THEN
    CREATE ROLE tovira_app LOGIN PASSWORD 'tovira_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO tovira_app;
-- Auth tables are accessed pre-authentication (before a user_id is known), so
-- they are not RLS-scoped; the app role just needs table access.
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions TO tovira_app;

-- First tenant-scoped table. Every tenant table carries user_id + RLS.
CREATE TABLE IF NOT EXISTS clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_user_id_idx ON clients(user_id);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;

-- Read AND write are constrained to the caller's tenant. With no context set,
-- current_setting returns NULL → no rows match → fail-closed.
DROP POLICY IF EXISTS clients_tenant_isolation ON clients;
CREATE POLICY clients_tenant_isolation ON clients
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO tovira_app;
