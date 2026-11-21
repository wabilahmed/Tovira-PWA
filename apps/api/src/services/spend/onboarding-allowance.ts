import type { AiAllowanceRepository } from '../../ports/ai-allowance-repository.js';

/**
 * [P81-3 · owner, 21 Nov] A one-time AED 20 onboarding allowance for imports in the account's first 14 days, separate
 * from the AED 45 monthly cap: a new rep's first-week imports (measured: about AED 19 for 15 chats of 800 messages,
 * batched) do not eat the month. It lives in the same allowance ledger as the month (ai_usage_month) under its own key
 * with period start 0, so it is reserved and settled with the same atomic calls, needs no migration, and never takes
 * part in the month's top-up carry-forward (its top-up is always 0).
 */
export const ONBOARDING_ALLOWANCE_AED = 20;
export const ONBOARDING_DAYS = 14;
export const ONBOARDING_PERIOD_KEY = 'onboarding';
const DAY_MS = 86_400_000;

export interface OnboardingAllowanceDeps {
  allowance: AiAllowanceRepository;
  /** When the account was created (ms), or null when unknown (then there is no onboarding allowance). */
  accountStartFor: (userId: string) => Promise<number | null>;
  aed?: number;
  days?: number;
  now?: () => number;
}

export class OnboardingAllowance {
  constructor(private readonly deps: OnboardingAllowanceDeps) {}
  private get aed(): number { return this.deps.aed ?? ONBOARDING_ALLOWANCE_AED; }

  /** True while the account is in its first 14 days. */
  async eligible(userId: string): Promise<boolean> {
    const start = await this.deps.accountStartFor(userId);
    const now = (this.deps.now ?? Date.now)();
    return start !== null && now < start + (this.deps.days ?? ONBOARDING_DAYS) * DAY_MS;
  }

  /** The allowance's ledger row (created on first use). */
  ensure(userId: string) {
    return this.deps.allowance.ensureMonth(userId, ONBOARDING_PERIOD_KEY, 0, this.aed);
  }

  /** What is left (spent and reserved taken off), or null outside the first 14 days. */
  async leftAed(userId: string): Promise<number | null> {
    if (!(await this.eligible(userId))) return null;
    const m = await this.ensure(userId);
    return Math.max(0, m.allowanceAed - m.spentAed - m.reservedAed);
  }
}

/** "Import allowance: AED X left", rounded DOWN (never more than is left); null when there is none. */
export function importAllowanceLine(leftAed: number | null): string | null {
  return leftAed === null ? null : `Import allowance: AED ${Math.floor(leftAed + 1e-9)} left`;
}
