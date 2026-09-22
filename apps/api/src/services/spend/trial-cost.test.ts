import { describe, it, expect } from 'vitest';
import { callCostUsd, USD_TO_AED, type CallUsage } from '../metrics/model-budget.js';

/**
 * [SPEND-INSTRUMENT] Confirm the AED 20 trial spend cap against the NOW-METERED extraction path: a real
 * rep's first fortnight — a genuine first import plus two weeks of daily notes — stays under AED 20, and
 * even a HEAVY-BUT-LEGIT rep clears it (the cap was raised 15→20 precisely so the most engaged prospect
 * isn't the one throttled). Abuse still reaches it.
 *
 * Cost is computed with the SAME pricing the metered sink uses (`callCostUsd`), so this validates the
 * cap against the path that now records extraction, not a hand figure. Trial extraction runs on **Sonnet**
 * (P5-7 routes trials to Sonnet-grade).
 *
 * PRICING CORRECTION (2026-09-22): the `claude-sonnet-5` row was Sonnet-4.6's numbers ($3/$15/$6/$0.30);
 * corrected to the published Sonnet-5 rates ($2/$10/$4/$0.20). Every figure below is ~1.5× lower than the
 * pre-correction derivation. Cross-check anchor: a 500-msg import now lists at ~AED 0.21/1,000 messages
 * (was ~AED 0.32). The INVOICE-anchored reconciliation (list price vs actual console billing) is separate
 * and pending the owner's console numbers.
 */
const TRIAL_CAP = 20;
const SONNET = 'claude-sonnet-5';
const aed = (u: CallUsage): number => callCostUsd(SONNET, u) * USD_TO_AED;

// A daily note extraction: the ~4k-token system prefix is CACHED (cache-read, ~0.1× input), the note
// itself is small (~300 fresh input tokens), and the structured output + reasoning is ~250 output tokens.
const DAILY_NOTE: CallUsage = { inputTokens: 300, outputTokens: 250, cacheReadInputTokens: 4000 };

// An imported chat (a WhatsApp export, avg ~500 messages ≈ ~10k input tokens; prefix cached). Bigger
// output for a fuller chat. Cross-check: 500 msgs × AED 0.34/1000 ≈ AED 0.17, matching aed(IMPORT_CHAT).
const IMPORT_CHAT: CallUsage = { inputTokens: 10000, outputTokens: 800, cacheReadInputTokens: 4000 };

describe('[SPEND-INSTRUMENT] a realistic trial first-fortnight stays under the AED 20 cap', () => {
  it('30-chat first import + ~5 daily notes/day for two weeks uses ~a fifth of the AED 20 cap', () => {
    const firstImport = 30 * aed(IMPORT_CHAT); // a real active book (~AED 3.2 at corrected prices)
    const dailyNotes = 70 * aed(DAILY_NOTE); // ~5/day × 14 days (~AED 1.0)
    const total = firstImport + dailyNotes; // ~AED 4.2
    expect(aed(IMPORT_CHAT)).toBeCloseTo(0.106, 2); // ~AED 0.106/chat (500 msgs) at corrected Sonnet-5 list price
    expect(total).toBeLessThan(TRIAL_CAP); // the trial cap holds…
    expect(total).toBeLessThan(TRIAL_CAP / 4); // …at ~a fifth of the cap — a genuine rep never notices
    expect(total).toBeGreaterThan(3); // and it's a real workload, not trivially tiny
  });

  // The HEAVIEST LEGITIMATE trial must clear the cap with margin, so the most engaged prospect isn't the
  // one throttled. At corrected prices it clears with EVEN MORE room than the pre-correction ~AED 15.3.
  it('a heavy-but-legit trial (40 big chats + ~10 notes/day ≈ AED 10.2) clears the AED 20 cap with margin', () => {
    const bigChat: CallUsage = { inputTokens: 20000, outputTokens: 1500, cacheReadInputTokens: 4000 };
    const heavyLegit = 40 * aed(bigChat) + 140 * aed(DAILY_NOTE);
    expect(heavyLegit).toBeLessThan(TRIAL_CAP); // clears 20 comfortably…
    expect(heavyLegit).toBeGreaterThan(8); // …and is genuinely heavy (~half the cap), not a toy workload
  });

  // The cap is not dead weight: a genuinely heavy / ABUSIVE trial still reaches it, at which point
  // extraction queues (the sweep skip) rather than spends. Because corrected per-extraction cost is ~1.5×
  // lower, the abuse threshold moved UP ~50% (more free extraction before the spend cap bites) — which is
  // exactly why the durable trialExtractionCeiling (~100 extractions) is the tighter binding limit on abuse.
  it('an abusive trial still reaches the AED 20 cap, so it bites', () => {
    const bigChat: CallUsage = { inputTokens: 20000, outputTokens: 1500, cacheReadInputTokens: 4000 };
    const abusive = 100 * aed(bigChat) + 200 * aed(DAILY_NOTE); // 100 big chats + ~14 notes/day
    expect(abusive).toBeGreaterThan(TRIAL_CAP); // reaches the cap → extraction queues; the cap is meaningful
  });
});
