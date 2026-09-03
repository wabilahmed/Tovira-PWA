import type { ModelClient } from '../../ports/model.js';
import type { PrioritiesRepository } from '../../ports/priorities-repository.js';
import type { TodayAction } from './hero-service.js';
import { extractJsonObject } from '../extraction/parse.js';
import { zonedTodayIso } from '../time/zone.js';

/**
 * Daily priorities, precomputed nightly and cached (cost-guard #3, P4b-3). The
 * expensive part — ranking the day's candidate actions with a model — runs ONCE
 * per rep per day (the nightly job, or the first open if none exists). App-opens
 * after that serve the stored copy with ZERO new model calls.
 *
 * The model may only REORDER the deterministic candidate actions (grounded): its
 * output is mapped back to the real actions by index, invalid indices are
 * dropped, and any omitted action is appended — so it can never fabricate or lose
 * a task. A garbage response falls back to the deterministic order.
 */

export class RefreshLimitError extends Error {
  override name = 'RefreshLimitError';
  constructor() {
    super('Daily refresh limit reached.');
  }
}

export interface PrioritiesSource {
  today(userId: string, nowMs: number): Promise<TodayAction[]>;
}

const RANK_SYSTEM = `You rank a salesperson's candidate actions for today by leverage. You are given a numbered list. Return ONLY a JSON array of the item numbers in priority order (highest first). Use only the numbers given; invent nothing.`;

function dayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export class PrioritiesService {
  private readonly refreshLimit: number;
  private readonly now: () => number;
  private readonly timezoneFor?: (userId: string) => Promise<string>;

  constructor(
    private readonly source: PrioritiesSource,
    private readonly model: ModelClient,
    private readonly repo: PrioritiesRepository,
    opts: { modelId?: string; refreshLimit?: number; now?: () => number; timezoneFor?: (userId: string) => Promise<string> } = {},
  ) {
    this.refreshLimit = opts.refreshLimit ?? 2;
    this.now = opts.now ?? (() => Date.now());
    this.timezoneFor = opts.timezoneFor;
  }

  /** [TZ-BOUNDARY] "today" is the rep's LOCAL calendar day — so the cache bucket flips when the rep
   *  crosses their own midnight (not 00:00 UTC), and the (userId, localDay) row is the per-rep-day
   *  idempotency record. Falls back to UTC only if no timezone resolver is wired (tests). */
  private async dayFor(userId: string, nowMs: number): Promise<string> {
    if (!this.timezoneFor) return dayOf(nowMs);
    return zonedTodayIso(await this.timezoneFor(userId), new Date(nowMs));
  }

  /** Read the day's cached priorities; compute once (and store) if absent. */
  async getForToday(userId: string, nowMs: number): Promise<TodayAction[]> {
    const day = await this.dayFor(userId, nowMs);
    const existing = await this.repo.get(userId, day);
    if (existing) return existing.actions; // cache hit → zero model calls
    const actions = await this.compute(userId, nowMs);
    await this.repo.save(userId, day, actions, 0);
    return actions;
  }

  /** Nightly job for one rep. Idempotent — skips if today's row already exists. */
  async precompute(userId: string, nowMs: number): Promise<boolean> {
    const day = await this.dayFor(userId, nowMs);
    if (await this.repo.get(userId, day)) return false; // already computed tonight
    const actions = await this.compute(userId, nowMs);
    await this.repo.save(userId, day, actions, 0);
    return true;
  }

  async precomputeAll(userIds: string[], nowMs: number): Promise<number> {
    let computed = 0;
    for (const id of userIds) if (await this.precompute(id, nowMs)) computed += 1;
    return computed;
  }

  /** Manual refresh — recompute, but capped server-side per rep per day. */
  async refresh(userId: string, nowMs: number): Promise<TodayAction[]> {
    const day = await this.dayFor(userId, nowMs);
    const existing = await this.repo.get(userId, day);
    const count = existing?.refreshCount ?? 0;
    if (count >= this.refreshLimit) throw new RefreshLimitError();
    const actions = await this.compute(userId, nowMs);
    await this.repo.save(userId, day, actions, count + 1);
    return actions;
  }

  /** How many manual refreshes remain today (for the UI). */
  async refreshesRemaining(userId: string, nowMs: number): Promise<number> {
    const existing = await this.repo.get(userId, await this.dayFor(userId, nowMs));
    return Math.max(0, this.refreshLimit - (existing?.refreshCount ?? 0));
  }

  /** Build the deterministic candidates, then ONE grounded model call to rank. */
  private async compute(userId: string, nowMs: number): Promise<TodayAction[]> {
    const actions = await this.source.today(userId, nowMs);
    if (actions.length === 0) return []; // nothing to rank — no model call
    let order: number[] = [];
    try {
      const res = await this.model.complete({
        system: RANK_SYSTEM,
        messages: [{ role: 'user', content: actions.map((a, i) => `${i}: ${a.text}`).join('\n') }],
        maxTokens: 256,
      });
      const parsed = extractJsonObject(res.text);
      if (Array.isArray(parsed)) order = parsed.filter((n): n is number => Number.isInteger(n));
    } catch {
      order = []; // model failure → deterministic order
    }
    // Grounding: map valid indices back to real actions; drop invalid; keep all.
    const seen = new Set<number>();
    const ranked: TodayAction[] = [];
    for (const i of order) {
      if (i >= 0 && i < actions.length && !seen.has(i)) {
        seen.add(i);
        ranked.push(actions[i]!);
      }
    }
    for (let i = 0; i < actions.length; i++) if (!seen.has(i)) ranked.push(actions[i]!); // never lose one
    return ranked;
  }
}
