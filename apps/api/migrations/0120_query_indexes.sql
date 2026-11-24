-- migrate:no-transaction
-- [P86 · index audit, owner 24 Nov] Indexes found missing by EXPLAIN on a realistic-volume Postgres 16 (200 reps x 100
-- clients, 2M chat messages, facts in proportion). Built CONCURRENTLY so writes are never blocked while they build;
-- every statement is idempotent (IF NOT EXISTS), so a failed boot re-runs this file to completion (see migrate.ts).
-- Guarded by db/query-plans.guard.test.ts: every app query is EXPLAINed on a seeded database in CI, and a sequential
-- scan of a large table or a foreign key with no index fails the build.

-- Foreign keys with no index on the referencing columns. A delete of the parent (a note, a client, a rep) otherwise
-- reads every row of the rep's child table to find the ones to cascade. Each leads with user_id (the rep).
CREATE INDEX CONCURRENTLY IF NOT EXISTS key_dates_user_note_idx ON key_dates (user_id, note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS key_dates_user_client_idx ON key_dates (user_id, client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS requirements_user_note_idx ON requirements (user_id, note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS extraction_logs_user_note_idx ON extraction_logs (user_id, note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS corrections_user_note_idx ON corrections (user_id, note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS promises_user_client_idx ON promises (user_id, client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS meetings_user_client_idx ON meetings (user_id, client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_user_client_idx ON notifications (user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS images_user_client_idx ON images (user_id, client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ledger_events_user_client_idx ON ledger_events (user_id, client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_shares_user_match_idx ON inventory_shares (user_id, match_id) WHERE match_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_pointers_client_idx ON client_pointers (client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS promise_kept_suggestions_client_idx ON promise_kept_suggestions (client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS promise_kept_suggestions_note_idx ON promise_kept_suggestions (note_id) WHERE note_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS access_requests_linked_user_idx ON access_requests (linked_user_id) WHERE linked_user_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS hot_leads_access_request_idx ON hot_leads (access_request_id) WHERE access_request_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS admin_invites_admin_idx ON admin_invites (admin_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions (admin_id);

-- The notes sweep (every 15s) asks "which reps have notes waiting?" in one query, and each rep's pending list reads
-- the same index. Partial: only notes still in flight, so it stays tiny however large the book grows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS notes_user_in_flight_idx ON notes (user_id, status)
  WHERE status IN ('pending_transcription', 'pending_extraction', 'extracting', 'pending_confirmation');

-- Tables that grow with every model call or message: range reads and retention deletes were sequential scans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS model_call_events_created_idx ON model_call_events (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS whatsapp_inbound_received_idx ON whatsapp_inbound (received_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS hot_leads_status_hot_idx ON hot_leads (status, became_hot_at DESC NULLS LAST, id DESC);

-- Daily jobs that read a small slice of every account: the trial emails (accounts on trial) and the free-access list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscriptions_trialing_idx ON subscriptions (trial_ends_at) WHERE status = 'trialing';
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscriptions_free_access_idx ON subscriptions (free_access_since) WHERE free_access_since IS NOT NULL;
