-- [SPEND-CAP] Per-account cap overrides AND their audit trail, in one append-only table. An ops
-- action, cross-tenant, on the superuser pool — no RLS. Each row: who raised it, when, to what
-- value, and why. The latest row for (user_id, period_key) is the effective cap; the whole set is
-- the audit. No FK to the rep (an audit row outlives account changes — the note_move_audit doctrine).
CREATE TABLE IF NOT EXISTS spend_overrides (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     text NOT NULL,
  period_key  text NOT NULL,
  cap_aed     double precision NOT NULL,
  raised_by   text NOT NULL,
  reason      text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spend_overrides_lookup_idx ON spend_overrides (user_id, period_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS spend_overrides_audit_idx ON spend_overrides (occurred_at DESC);
