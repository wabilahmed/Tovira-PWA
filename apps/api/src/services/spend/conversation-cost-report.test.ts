/**
 * [SPEND-INSTRUMENT B4 · ASK-CONVO] Per-turn conversation cost, from the durable per-call log.
 *
 * Proves: (1) per-turn records exist and are attributable to a conversation — recorded through the same
 * metered event sink every model call uses; (2) the report reads them in turn order with a running total,
 * never recomputing; (3) one conversation's curve never bleeds into another's, or another rep's; (4) the
 * measured cost of a realistic 20-turn conversation TODAY — priced with the real Anthropic pricing and the
 * real verbatim-window mechanics (history plateaus once the 20-message window fills), so the growth is
 * bounded, not runaway. Modeled from real pricing, not a live spend (the DoD forbids cloud calls).
 */
import { describe, it, expect } from 'vitest';
import { InMemoryModelCallEventStore } from '../../adapters/spend/in-memory-model-call-event-store.js';
import { ModelCallEventService } from './model-call-event-service.js';
import { conversationCostReport } from './conversation-cost-report.js';
import { callCostUsd, USD_TO_AED } from '../metrics/model-budget.js';
import type { ModelUsage } from '../../ports/model.js';

const HAIKU = 'claude-haiku-4-5-20251001'; // recall runs on the cheap model
const periodFor = async () => 'p:2026-10';

describe('[SPEND-INSTRUMENT] conversation cost by turn', () => {
  it('records per-turn cost attributable to a conversation, read back in turn order with a running total', async () => {
    const store = new InMemoryModelCallEventStore();
    const svc = new ModelCallEventService(store, periodFor, () => 1000);
    // Three turns of one rep's conversation, recorded through the metered event sink.
    const usage = (over: Partial<ModelUsage>): ModelUsage => ({ inputTokens: 500, outputTokens: 150, cacheReadInputTokens: 700, ...over });
    await svc.record('rep-A', 'recall', HAIKU, usage({ inputTokens: 500 }), { conversationId: 'sess-1', turnIndex: 1 });
    await svc.record('rep-A', 'recall', HAIKU, usage({ inputTokens: 900 }), { conversationId: 'sess-1', turnIndex: 2 });
    await svc.record('rep-A', 'recall', HAIKU, usage({ inputTokens: 1300 }), { conversationId: 'sess-1', turnIndex: 3 });

    const report = await conversationCostReport(store, 'rep-A', 'sess-1');
    expect(report.total.turns).toBe(3);
    expect(report.turns.map((t) => t.turnIndex)).toEqual([1, 2, 3]); // turn order
    // context size (fresh input + cache-read) grows as history accretes.
    expect(report.turns.map((t) => t.contextTokens)).toEqual([1200, 1600, 2000]);
    // running total is monotonic and equals the last turn's cumulative.
    const cum = report.turns.map((t) => t.cumulativeCostAed);
    expect(cum[0]! < cum[1]! && cum[1]! < cum[2]!).toBe(true);
    expect(report.total.costAed).toBeCloseTo(cum[2]!, 5); // running total ≈ last cumulative (rounding at 1e-6)
  });

  it('isolation: a conversation curve never includes another conversation or another rep', async () => {
    const store = new InMemoryModelCallEventStore();
    const svc = new ModelCallEventService(store, periodFor, () => 1000);
    const u: ModelUsage = { inputTokens: 500, outputTokens: 100, cacheReadInputTokens: 700 };
    await svc.record('rep-A', 'recall', HAIKU, u, { conversationId: 'sess-1', turnIndex: 1 });
    await svc.record('rep-A', 'recall', HAIKU, u, { conversationId: 'sess-2', turnIndex: 1 }); // rep-A, other convo
    await svc.record('rep-B', 'recall', HAIKU, u, { conversationId: 'sess-1', turnIndex: 1 }); // other rep, same id

    const a1 = await conversationCostReport(store, 'rep-A', 'sess-1');
    expect(a1.total.turns).toBe(1); // NOT 2 (sess-2 excluded) and NOT 3 (rep-B excluded)
  });

  it('one-shot calls (no conversation attribution) never appear as conversation turns', async () => {
    const store = new InMemoryModelCallEventStore();
    const svc = new ModelCallEventService(store, periodFor, () => 1000);
    await svc.record('rep-A', 'extraction', 'claude-sonnet-5', { inputTokens: 5000, outputTokens: 500 }); // no attribution
    const report = await conversationCostReport(store, 'rep-A', 'sess-1');
    expect(report.total.turns).toBe(0);
  });

  // The measurement the batch asks for: what does a 20-turn conversation cost TODAY?
  it('measures a realistic 20-turn conversation — cost is bounded because the history window plateaus', async () => {
    const store = new InMemoryModelCallEventStore();
    const svc = new ModelCallEventService(store, periodFor, () => 1000);
    // Real recall mechanics: system prefix cached (~700 tok cache-read after turn 1); retrieval capped at
    // the 1200-token budget; the verbatim history window holds the last 20 messages (10 turns) — so the
    // re-sent history STOPS growing at turn 11. Each prior turn ≈ question(20) + answer(150) = 170 tokens.
    const SYSTEM_CACHED = 700, RETRIEVAL = 1200, QUESTION = 20, ANSWER = 150, PRIOR_TURN = QUESTION + ANSWER, WINDOW_TURNS = 10;
    for (let t = 1; t <= 20; t++) {
      const priorTurnsInWindow = Math.min(t - 1, WINDOW_TURNS); // history plateaus once the window fills
      const historyTokens = priorTurnsInWindow * PRIOR_TURN;
      const freshInput = QUESTION + RETRIEVAL + historyTokens; // billed at full input rate
      await svc.record('rep-A', 'recall', HAIKU, { inputTokens: freshInput, outputTokens: ANSWER, cacheReadInputTokens: SYSTEM_CACHED, cacheCreationInputTokens: t === 1 ? SYSTEM_CACHED : 0 }, { conversationId: 'c20', turnIndex: t });
    }
    const report = await conversationCostReport(store, 'rep-A', 'c20');
    expect(report.total.turns).toBe(20);

    const perTurnAed = report.turns.map((t) => t.costAed);
    // Growth is bounded: turn 15 and turn 20 cost the SAME (both past the window fill at turn 11).
    expect(perTurnAed[14]).toBeCloseTo(perTurnAed[19]!, 6);
    // And the last turn costs more than the first (context did grow before plateauing).
    expect(perTurnAed[19]! > perTurnAed[0]!).toBe(true);

    // Cross-check the report's total against the pricing function directly (reads recorded cost, never recomputes).
    let expectedUsd = 0;
    for (let t = 1; t <= 20; t++) {
      const priorTurnsInWindow = Math.min(t - 1, WINDOW_TURNS);
      const freshInput = QUESTION + RETRIEVAL + priorTurnsInWindow * PRIOR_TURN;
      expectedUsd += callCostUsd(HAIKU, { inputTokens: freshInput, outputTokens: ANSWER, cacheReadInputTokens: SYSTEM_CACHED, cacheCreationInputTokens: t === 1 ? SYSTEM_CACHED : 0 });
    }
    expect(report.total.costAed).toBeCloseTo(expectedUsd * USD_TO_AED, 4);

    // The measured number (printed for the batch report). A 20-turn recall conversation is well under 1 AED.
    console.log(`[ASK-CONVO] 20-turn recall conversation TODAY: ${report.total.costAed.toFixed(4)} AED (${(expectedUsd).toFixed(5)} USD); per-turn plateau ${perTurnAed[19]!.toFixed(5)} AED`);
    expect(report.total.costAed).toBeLessThan(1); // bounded — no runaway context cost
  });
});
