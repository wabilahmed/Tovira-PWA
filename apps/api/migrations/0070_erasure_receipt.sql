-- [ERASURE-RECEIPT · Privacy §10 Task 3] Minimal, compliance-grade proof that a single-counterparty
-- erasure was HONOURED, retained BEYOND account deletion.
--
-- The tenant `erasure_audit` (0066) is on the users FK cascade, so deleting the rep's account destroys
-- the only proof the erasure ran. This table is the durable proof, and is shaped so the cascade CANNOT
-- reach it:
--   * NO user_id and NO foreign key of any kind — it is not tenant data and nothing cascades into it.
--   * NO requester name, NO rep id, NO erased content — only the request id, the two dates, and per-store
--     COUNTS (categories jsonb: [{category, deleted}]). The leanest record that still proves erasure.
-- It is (pseudonymous) personal data all the same — a request id + dates is indirectly linkable — so it
-- is retained under its own legal-obligation basis with its own cap, never merged back into rep data.
--
-- NO RLS: it is not tenant-scoped (there is no user_id to scope by). Append-only: the app role may INSERT
-- (written when an erasure completes) but has NO SELECT/UPDATE/DELETE — reads are ops-only via the root
-- pool, and nothing may amend or remove a compliance receipt.
CREATE TABLE IF NOT EXISTS erasure_receipts (
  request_id   uuid PRIMARY KEY,            -- the originating request's id; a bare identifier, NOT an FK
  received_at  timestamptz NOT NULL,        -- date the erasure request was received
  completed_at timestamptz NOT NULL DEFAULT now(),
  categories   jsonb NOT NULL DEFAULT '[]'::jsonb  -- per-store counts only; never content or names
);

-- The app role inserts one receipt when an erasure completes; it may not read, amend, or delete them.
GRANT INSERT ON erasure_receipts TO tovira_app;
