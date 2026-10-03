-- 0082_ai_pause.sql — [USAGE-ALLOWANCE · D14 runtime kill switch]
--
-- AI_PAUSED is no longer boot-only: the gate reads this single-row flag (with a <=30s cache) so the
-- owner can stop all AI processing NOW via the token-gated /ops/ai-pause route without a redeploy. The
-- AI_PAUSED env var, when set, still forces pause ON at boot (OR-ed with this row). Platform-global
-- (no user_id) — not tenant-scoped; read/written on the superuser pool.
CREATE TABLE IF NOT EXISTS ai_pause (
  id         boolean PRIMARY KEY DEFAULT true,
  paused     boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_pause_singleton CHECK (id)
);
INSERT INTO ai_pause (id, paused) VALUES (true, false) ON CONFLICT (id) DO NOTHING;
GRANT SELECT, INSERT, UPDATE ON ai_pause TO tovira_app;
