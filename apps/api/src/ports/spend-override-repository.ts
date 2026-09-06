/**
 * [SPEND-CAP] Per-account cap overrides — and their audit trail, in one append-only table. A
 * legitimate rep in a heavy onboarding month must not stall while ops notices; an operator raises
 * the cap for a named rep + period, which (the rep now under cap) lets the sweep drain their queue.
 * Every override is a row — who, when, to what value, why — so the latest row is the effective cap
 * and the whole set is the audit. A spend decision should leave a trail.
 */
export interface SpendOverride {
  id: string;
  userId: string;
  periodKey: string;
  capAed: number;
  raisedBy: string; // the ops actor
  reason: string;
  occurredAt: number;
}

export interface NewSpendOverride {
  userId: string;
  periodKey: string;
  capAed: number;
  raisedBy: string;
  reason: string;
}

export interface SpendOverrideRepository {
  /** Append an override (audited). */
  set(o: NewSpendOverride): Promise<SpendOverride>;
  /** The effective cap for (rep, period) — the latest override's value, or null if none. */
  effectiveCap(userId: string, periodKey: string): Promise<number | null>;
  /** Recent overrides, newest first — the audit trail (ops view). */
  listAudit(limit: number): Promise<SpendOverride[]>;
}
