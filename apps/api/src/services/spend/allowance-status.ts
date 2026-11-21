import type { AiAllowanceRepository } from '../../ports/ai-allowance-repository.js';
import { allowanceWindow, windowAllowance, type AllowanceWindowInput } from './ai-period.js';

/**
 * [USAGE-ALLOWANCE] The rep-facing allowance status (D3/D4/D8) and the pre-call "is AI stopped?" check.
 * The rep ever sees ONLY a percentage (D3): rounded DOWN, and never 100% until AI has actually stopped.
 * `exhausted` is the stop state: no headroom remains for even the next call, so import/questions/jobs
 * refuse up front instead of calling a model to discover it.
 */
export interface AllowanceStatus {
  allowanceAed: number;
  topupAed: number;
  spentAed: number;
  reservedAed: number;
  availableAed: number;
  /** Whole-percent used, rounded DOWN; capped at 99 until `exhausted` (D3). */
  percentUsed: number;
  /** [P20-1c] The same figure UNFLOORED (capped just under 100 until exhausted, 100 when exhausted), so
   *  the UI can render "<1%" and one decimal under 10% instead of a distrust-inducing flat "0%". */
  rawPercentUsed: number;
  /** True when spent + reserved leaves no headroom — AI features stop (D4). */
  exhausted: boolean;
  /** When this window's allowance resets (ms) — the "paused until …" banner date (D9). */
  resetAtMs: number;
  /** [P37] The top-up balance still unspent, as a whole % of the monthly allowance (rounded down) — "Extra
   *  usage: +80% left (never expires)". The month is used first, so this only falls once the month is spent. */
  extraPercentLeft: number;
  /** [P83] Messages: the plan's messages this window (10,000). */
  messagesAllowance: number;
  /** [P83] Messages read from imported chats this window. */
  messagesUsed: number;
  /** [P83] Plan + pack messages available this window. */
  messagesTotal: number;
  /** [P83] Messages left (the month's first, then packs). */
  messagesLeft: number;
  /** [P83] Pack messages still unused (never expire): "Extra messages: 1,500 left". */
  packMessagesLeft: number;
  /** [P83] No messages left: imports stop until a pack or the reset. */
  messagesExhausted: boolean;
  /** [P83] "+N messages added" by the last pack this window, or null. */
  lastTopupMessages: number | null;
  /** [P84-5] This is the trial's window (5,000 messages, no monthly reset). */
  trial: boolean;
}

export interface AllowanceStatusDeps {
  allowance: AiAllowanceRepository;
  allowanceAed: number;
  /** [P83] Messages a month on the plan (config.monthlyMessages). Default 10,000. */
  messagesAllowance?: number;
  /** [P84-5] The trial window's AED gate (AED 30) and messages (5,000). Absent → the plan's. */
  trialAllowanceAed?: number;
  trialMessagesAllowance?: number;
  billingWindowFor: (userId: string) => Promise<AllowanceWindowInput>;
  now?: () => number;
}

// Floating-point slack: treat headroom within a thousandth of a fil as gone.
const EPS = 1e-6;

export class AllowanceStatusService {
  private readonly now: () => number;
  constructor(private readonly deps: AllowanceStatusDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Open (or read) this window's row with the right figures: the trial's for a trial window, else the plan's. */
  private open(userId: string, w: { key: string; startMs: number }) {
    const a = windowAllowance(w.key, { aed: this.deps.allowanceAed, messages: this.deps.messagesAllowance }, { aed: this.deps.trialAllowanceAed, messages: this.deps.trialMessagesAllowance });
    return this.deps.allowance.ensureMonth(userId, w.key, w.startMs, a.aed, a.messages);
  }

  async status(userId: string): Promise<AllowanceStatus> {
    const w = allowanceWindow(await this.deps.billingWindowFor(userId), this.now());
    const m = await this.open(userId, w);
    const availableAed = m.allowanceAed + m.topupAed;
    // [sticky] a prior refusal pins exhaustion even if settled spend is below the allowance.
    const exhausted = m.displayExhausted || m.spentAed + m.reservedAed >= availableAed - EPS;
    const fraction = availableAed <= 0 ? 100 : (m.spentAed / availableAed) * 100;
    // Never show 100% until the stop has actually happened (D3) — floored for the bar, unfloored for text.
    const percentUsed = exhausted ? 100 : Math.min(99, Math.max(0, Math.floor(fraction)));
    const rawPercentUsed = exhausted ? 100 : Math.min(99.9, Math.max(0, fraction));
    return {
      allowanceAed: m.allowanceAed,
      topupAed: m.topupAed,
      spentAed: m.spentAed,
      reservedAed: m.reservedAed,
      availableAed,
      percentUsed,
      rawPercentUsed,
      exhausted,
      resetAtMs: w.endMs,
      extraPercentLeft: m.allowanceAed > 0
        ? Math.floor((Math.max(0, m.topupAed - Math.max(0, m.spentAed - m.allowanceAed)) / m.allowanceAed) * 100 + 1e-9)
        : 0,
      messagesAllowance: m.messagesAllowance,
      messagesUsed: m.messagesUsed,
      messagesTotal: m.messagesAllowance + m.messagesTopup,
      messagesLeft: Math.max(0, m.messagesAllowance + m.messagesTopup - m.messagesUsed),
      packMessagesLeft: Math.max(0, m.messagesTopup - Math.max(0, m.messagesUsed - m.messagesAllowance)),
      messagesExhausted: m.messagesUsed >= m.messagesAllowance + m.messagesTopup,
      lastTopupMessages: m.lastTopupMessages,
      trial: w.key.startsWith('trial:'),
    };
  }

  /** [P83] May a chat with `messages` to read be imported now? Enough messages left (month + packs) and the AED gate
   *  not stopped. A chat with nothing to read always may (it costs no messages). */
  async canRead(userId: string, messages: number): Promise<{ ok: boolean; messagesLeft: number; status: AllowanceStatus }> {
    const status = await this.status(userId);
    return { ok: !status.exhausted && (messages <= 0 || messages <= status.messagesLeft), messagesLeft: status.messagesLeft, status };
  }

  /** [P83] Count an imported chat's messages, once per note (the month's first, then packs). True when counted now or
   *  already counted; false when not enough are left (the chat then waits, unread). */
  async chargeMessages(userId: string, noteId: string, messages: number): Promise<boolean> {
    if (messages <= 0) return true;
    const w = allowanceWindow(await this.deps.billingWindowFor(userId), this.now());
    await this.open(userId, w);
    return (await this.deps.allowance.chargeMessages(userId, w.key, noteId, messages)) !== 'insufficient';
  }

  /** [P84-6] Reading a chat failed for good: give its messages back (once). Returns how many. */
  refundMessages(userId: string, noteId: string): Promise<number> {
    return this.deps.allowance.refundMessages(userId, noteId);
  }

  /** [P84-9] Were this chat's messages already counted? */
  isCharged(userId: string, noteId: string): Promise<boolean> {
    return this.deps.allowance.isCharged(userId, noteId);
  }

  /** The pre-call gate used by import/questions/jobs: has this rep's AI stopped? */
  async isExhausted(userId: string): Promise<boolean> {
    return (await this.status(userId)).exhausted;
  }
}
