import { describe, it, expect } from 'vitest';
import { SpendCap, SpendCapExceeded, RunOverCap, worstCaseCallAed, worstCaseRunAed, startWithinCap, plannedCallOf } from './spend-cap.js';
import { anthropicCostUsd, usdToAed } from '../services/spend/ai-prices.js';
import { OUTPUT_CEILING } from '../services/extraction/extraction-service.js';
import type { ModelCompletionRequest } from '../ports/model.js';

/**
 * [P83-9 · owner, 21 Nov] A measurement cap is a HARD stop. The last accuracy round reached AED 11.89 against a cap of
 * 10 because the check used a measured average per piece. Now a run refuses to start when what is already spent plus
 * the run's WORST case would pass the cap: every piece at the output ceiling (thinking included) plus its whole input
 * at the highest input rate, from the shared price table, at batch half price only for a batch run.
 */
const MODEL = 'claude-sonnet-5';
const piece = { inputChars: 60_000, maxOutputTokens: OUTPUT_CEILING };

describe('[P83-9] the worst case comes from the shared price table', () => {
  it('one call: every input char as a cache-writing token, plus the output ceiling as output', () => {
    const want = usdToAed(anthropicCostUsd(MODEL, { inputTokens: 0, cacheCreationInputTokens: 60_000, outputTokens: OUTPUT_CEILING }));
    expect(worstCaseCallAed(MODEL, piece, { batch: false })).toBeCloseTo(want, 9);
  });
  it('the batch price is used only for a batch run (exactly half)', () => {
    const live = worstCaseRunAed(MODEL, [piece, piece], { batch: false });
    const batch = worstCaseRunAed(MODEL, [piece, piece], { batch: true });
    expect(batch).toBeCloseTo(live / 2, 9);
    expect(live).toBeCloseTo(2 * worstCaseCallAed(MODEL, piece, { batch: false }), 9);
  });
  it('a raw Messages API body: its whole system + messages text is input, its max_tokens the output (else the ceiling)', () => {
    const body = { system: [{ type: 'text', text: 'x'.repeat(1000) }], messages: [{ role: 'user', content: 'y'.repeat(500) }], max_tokens: 32_000 };
    const c = plannedCallOf(body, OUTPUT_CEILING);
    expect(c.inputChars).toBeGreaterThanOrEqual(1500);
    expect(c.maxOutputTokens).toBe(32_000);
    expect(plannedCallOf({ messages: [{ role: 'user', content: 'hi' }] }, OUTPUT_CEILING).maxOutputTokens).toBe(OUTPUT_CEILING);
  });
});

describe('[P83-9] a run whose worst case crosses the cap never starts', () => {
  const counting = () => { let calls = 0; return { send: async () => { calls += 1; return 'sent'; }, calls: () => calls }; };

  it('refused before any model call (0 calls), with the estimate in the message', async () => {
    const c = counting();
    const pieces = Array.from({ length: 34 }, () => piece);
    const worst = worstCaseRunAed(MODEL, pieces, { batch: true });
    expect(worst).toBeGreaterThan(10);
    const err = await startWithinCap({ model: MODEL, calls: pieces, batch: true, spentAed: 0, capAed: 10, log: () => undefined }, c.send).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunOverCap);
    expect(String((err as Error).message)).toMatch(/worst case AED \d+\.\d\d/);
    expect(String((err as Error).message)).toMatch(/cap AED 10\.00/);
    expect(c.calls()).toBe(0);
  });
  it('what was already spent this round counts: a run that fits alone is refused when the round is nearly spent', async () => {
    const c = counting();
    const one = worstCaseRunAed(MODEL, [piece], { batch: true });
    await expect(startWithinCap({ model: MODEL, calls: [piece], batch: true, spentAed: 10 - one / 2, capAed: 10, log: () => undefined }, c.send)).rejects.toBeInstanceOf(RunOverCap);
    expect(c.calls()).toBe(0);
  });
  it('a run that fits starts (and the estimate is printed)', async () => {
    const c = counting();
    const lines: string[] = [];
    const r = await startWithinCap({ model: MODEL, calls: [piece, piece], batch: true, spentAed: 1, capAed: 10, log: (l) => lines.push(l) }, c.send);
    expect(r).toBe('sent');
    expect(c.calls()).toBe(1);
    expect(lines.join('\n')).toMatch(/worst case AED \d+\.\d\d/);
  });
  it('the same pieces fit as a batch but not live (the batch price only for a batch run)', async () => {
    const pieces = [piece, piece, piece, piece];
    const live = worstCaseRunAed(MODEL, pieces, { batch: false });
    const cap = live * 0.75; // between the batch worst case (live / 2) and the live one
    const c = counting();
    await expect(startWithinCap({ model: MODEL, calls: pieces, batch: false, spentAed: 0, capAed: cap, log: () => undefined }, c.send)).rejects.toBeInstanceOf(RunOverCap);
    expect(c.calls()).toBe(0);
    await startWithinCap({ model: MODEL, calls: pieces, batch: true, spentAed: 0, capAed: cap, log: () => undefined }, c.send);
    expect(c.calls()).toBe(1);
  });
});

describe('[P83-9] live measurement runs: no call is sent whose worst case would pass the cap', () => {
  const req = (chars: number): ModelCompletionRequest => ({ system: 's'.repeat(chars), messages: [{ role: 'user', content: 'hi' }], maxTokens: OUTPUT_CEILING });
  it('guard refuses BEFORE the call when spent + this call\'s worst case passes the cap', () => {
    const cap = new SpendCap(1.0);
    expect(() => cap.guard(MODEL, req(40_000))).toThrow(SpendCapExceeded); // worst case ~AED 1.76 > 1
    expect(cap.calls).toBe(0);
  });
  it('guard lets a call that fits through, and without a cap never refuses', () => {
    const cap = new SpendCap(5.0);
    expect(() => cap.guard(MODEL, req(10_000))).not.toThrow();
    expect(() => new SpendCap(undefined).guard(MODEL, req(1_000_000))).not.toThrow();
  });
});
