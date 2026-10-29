import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isClientRequestAsRepPromise, requestAsPromiseTally } from './request-as-promise.js';
import type { ExtractedPromise } from '../services/extraction/types.js';
import type { DeployLedgerEntry } from './deploy-ledger.js';

// [P56-2 · owner] Report only, never gated: a running tally, across gates, of invented promises where something the client
// asked for was recorded as the rep's promise ("He wants the pricing in writing" → rep: "Send the pricing in writing").
const p = (source_span: string | null, owner: ExtractedPromise['owner'] = 'rep'): ExtractedPromise =>
  ({ text: 'x', owner, due_date: null, due_raw: null, confidence: 'low', source_span, source_message_at: null }) as ExtractedPromise;

describe('[P56-2] a client request recorded as a rep promise', () => {
  it('the P55 certification case: "He wants the pricing in writing before their CFO signs off."', () => {
    expect(isClientRequestAsRepPromise(p('He wants the pricing in writing before their CFO signs off.'))).toBe(true);
  });
  it('other ways a client asks', () => {
    for (const q of ['She asked for the catalogue by Monday', 'Can you send the brochure?', 'Could you share the price list', 'They requested a site visit', 'He would like a demo next week', 'Please send the contract', 'Omar needs the quote by Friday', 'Sir kindly send the quotation']) expect(isClientRequestAsRepPromise(p(q)), q).toBe(true);
  });
  it('NEGATIVE: the rep committing in the quote is not a request (the P55 run-3 rewording)', () => {
    for (const q of ["Once the payment to IBAN [IBAN redacted] clears, I'll release the shipment on 8 September 2026.", 'He wants the pricing; I will send it tomorrow', "Sure, we'll send it Friday", 'I promised to call him back', 'Let me send you the deck']) expect(isClientRequestAsRepPromise(p(q)), q).toBe(false);
  });
  it('NEGATIVE: a promise owned by the client, or with no quote, is not counted', () => {
    expect(isClientRequestAsRepPromise(p('He wants the pricing in writing', 'client'))).toBe(false);
    expect(isClientRequestAsRepPromise(p(null))).toBe(false);
  });
});

describe('[P56-2] the running tally across gates', () => {
  type V = Extract<DeployLedgerEntry, { type: 'verdict' }>;
  const v = (sha: string, counters: Record<string, number>, attempt = 1): V => ({ type: 'verdict', sha, runId: sha, attempt, at: 'x', mode: 'normal', deployGate: 'PASS', certification: 'PROVISIONAL', counters });
  it('sums the gates that recorded it, plus this gate; older verdicts without the counter are not counted as zero', () => {
    const ledger = [v('a', { fabricated: 3 }), v('b', { requestAsPromise: 1, fabricated: 2 }), v('c', { requestAsPromise: 0, fabricated: 0 }), { type: 'ci_green', sha: 'c', runId: '1', at: 'x' } as DeployLedgerEntry];
    expect(requestAsPromiseTally(ledger, { requestAsPromise: 2, fabricated: 4 })).toEqual({ cases: 3, fabricated: 6, gates: 3 });
  });
  it('a re-run of the same gate run (same run and attempt) is counted once', () => {
    expect(requestAsPromiseTally([v('b', { requestAsPromise: 1, fabricated: 1 }), v('b', { requestAsPromise: 1, fabricated: 1 })], { requestAsPromise: 0, fabricated: 0 })).toEqual({ cases: 1, fabricated: 1, gates: 2 });
  });
  it('an empty ledger is just this gate', () => {
    expect(requestAsPromiseTally([], { requestAsPromise: 1, fabricated: 2 })).toEqual({ cases: 1, fabricated: 2, gates: 1 });
  });
});

describe('[P56-2] wired into the gate (reported, never gated)', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  it('each invented promise is classified, the count goes into the verdict, and the running tally is printed', () => {
    expect(src).toMatch(/isClientRequestAsRepPromise\(fp\)/);
    expect(src).toMatch(/requestAsPromise: requestAsPromiseCases/);
    expect(src).toMatch(/CLIENT REQUEST → REP PROMISE \[reported\]/);
  });
  it('it never touches the deploy decision', () => {
    expect(src).not.toMatch(/deployPass = [^;]*requestAsPromise/);
  });
});
