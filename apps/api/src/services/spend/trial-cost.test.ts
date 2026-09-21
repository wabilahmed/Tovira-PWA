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
 * (P5-7 routes trials to Sonnet-grade). Token profiles are derived from the measured import cost
 * (~AED 0.34 / 1,000 messages; a 5,615-message import ≈ AED 2.3–2.5 warm) — see the derivations inline.
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
  it('30-chat first import + ~5 daily notes/day for two weeks uses ~a third of the AED 20 cap', () => {
    const firstImport = 30 * aed(IMPORT_CHAT); // a real active book (~AED 4.8)
    const dailyNotes = 70 * aed(DAILY_NOTE); // ~5/day × 14 days (~AED 1.5)
    const total = firstImport + dailyNotes; // ~AED 6.3
    expect(aed(IMPORT_CHAT)).toBeCloseTo(0.16, 1); // ~AED 0.16/chat — matches the measured AED 0.34/1000 msgs
    expect(total).toBeLessThan(TRIAL_CAP); // the trial cap holds…
    expect(total).toBeLessThan(TRIAL_CAP / 2.5); // …at ~a third of the cap — a genuine rep never notices
    expect(total).toBeGreaterThan(3); // and it's a real workload, not trivially tiny
  });

  // The raise 15→20 exists for exactly this rep: the HEAVIEST LEGITIMATE trial must clear the cap with
  // margin, so the most engaged prospect isn't the one throttled.
  it('a heavy-but-legit trial (40 big chats + ~10 notes/day ≈ AED 15.3) clears the AED 20 cap with margin', () => {
    const bigChat: CallUsage = { inputTokens: 20000, outputTokens: 1500, cacheReadInputTokens: 4000 };
    const heavyLegit = 40 * aed(bigChat) + 140 * aed(DAILY_NOTE);
    expect(heavyLegit).toBeLessThan(TRIAL_CAP); // clears 20…
    expect(heavyLegit).toBeGreaterThan(15); // …but would have been throttled at the old 15 (why we raised it)
  });

  // The cap is not dead weight: a genuinely heavy / ABUSIVE trial still reaches it, at which point
  // extraction queues (the sweep skip) rather than spends. Farming value stays under half the old AED 45.
  it('an abusive trial still reaches the AED 20 cap, so it bites', () => {
    const bigChat: CallUsage = { inputTokens: 20000, outputTokens: 1500, cacheReadInputTokens: 4000 };
    const abusive = 70 * aed(bigChat) + 200 * aed(DAILY_NOTE); // 70 big chats + ~14 notes/day
    expect(abusive).toBeGreaterThan(TRIAL_CAP); // reaches the cap → extraction queues; the cap is meaningful
  });
});
