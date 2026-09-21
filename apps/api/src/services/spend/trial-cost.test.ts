import { describe, it, expect } from 'vitest';
import { callCostUsd, USD_TO_AED, type CallUsage } from '../metrics/model-budget.js';

/**
 * [SPEND-INSTRUMENT] Confirm the AED 15 trial spend cap against the NOW-METERED extraction path: a real
 * rep's first fortnight — a genuine first import plus two weeks of daily notes — stays under AED 15.
 *
 * Cost is computed with the SAME pricing the metered sink uses (`callCostUsd`), so this validates the
 * cap against the path that now records extraction, not a hand figure. Trial extraction runs on **Sonnet**
 * (P5-7 routes trials to Sonnet-grade). Token profiles are derived from the measured import cost
 * (~AED 0.34 / 1,000 messages; a 5,615-message import ≈ AED 2.3–2.5 warm) — see the derivations inline.
 */
const SONNET = 'claude-sonnet-5';
const aed = (u: CallUsage): number => callCostUsd(SONNET, u) * USD_TO_AED;

// A daily note extraction: the ~4k-token system prefix is CACHED (cache-read, ~0.1× input), the note
// itself is small (~300 fresh input tokens), and the structured output + reasoning is ~250 output tokens.
const DAILY_NOTE: CallUsage = { inputTokens: 300, outputTokens: 250, cacheReadInputTokens: 4000 };

// An imported chat (a WhatsApp export, avg ~500 messages ≈ ~10k input tokens; prefix cached). Bigger
// output for a fuller chat. Cross-check: 500 msgs × AED 0.34/1000 ≈ AED 0.17, matching aed(IMPORT_CHAT).
const IMPORT_CHAT: CallUsage = { inputTokens: 10000, outputTokens: 800, cacheReadInputTokens: 4000 };

describe('[SPEND-INSTRUMENT] a realistic trial first-fortnight stays under the AED 15 cap', () => {
  it('30-chat first import + ~5 daily notes/day for two weeks is well under AED 15 (with headroom)', () => {
    const firstImport = 30 * aed(IMPORT_CHAT); // a real active book (~AED 4.8)
    const dailyNotes = 70 * aed(DAILY_NOTE); // ~5/day × 14 days (~AED 1.5)
    const total = firstImport + dailyNotes; // ~AED 6.3
    expect(aed(IMPORT_CHAT)).toBeCloseTo(0.16, 1); // ~AED 0.16/chat — matches the measured AED 0.34/1000 msgs
    expect(total).toBeLessThan(15); // the trial cap holds…
    expect(total).toBeLessThan(10); // …with real headroom — a genuine rep is at ~40% of the cap
    expect(total).toBeGreaterThan(3); // and it's a real workload, not trivially tiny
  });

  // The cap is not dead weight: a genuinely heavy / abusive trial DOES reach it, at which point
  // extraction queues (the sweep skip) rather than spends. So AED 15 sits between a real rep (~6) and
  // abuse — a real rep never notices; farming is bounded.
  it('a heavy/abusive trial reaches the cap, so it actually bites', () => {
    const bigChat: CallUsage = { inputTokens: 20000, outputTokens: 1500, cacheReadInputTokens: 4000 };
    const heavy = 60 * aed(bigChat) + 140 * aed(DAILY_NOTE); // 60 big chats + ~10 notes/day
    expect(heavy).toBeGreaterThan(15); // reaches the cap → extraction queues; the cap is meaningful
  });
});
