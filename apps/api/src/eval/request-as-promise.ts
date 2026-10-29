import type { ExtractedPromise } from '../services/extraction/types.js';
import type { DeployLedgerEntry } from './deploy-ledger.js';

/**
 * [P56-2 · owner] Report only, never gated: an invented promise where something the client ASKED for was recorded as the
 * rep's promise ("He wants the pricing in writing before their CFO signs off" → rep: "Send the pricing in writing").
 * A heuristic over the promise's quote: a rep-owned promise whose quote carries a request cue and no first-person
 * commitment. It runs only on promises the scorer already counted as invented (fab-cases.ts). Outside the gate surfaces
 * on purpose (eval/extraction-fingerprint.ts): reporting, not scoring.
 */
const REQUEST = /\b(?:wants?|wanted|asks?|asked|asking|requests?|requested|would like|wishes|needs?|needed|expects?|expecting|is waiting for|can you|could you|would you|please|pls|kindly)\b/i;
const COMMIT = /\b(?:i'll|i will|i'd|we'll|we will|i can|we can|i promised|we promised|let me|i'm going to|we're going to|i shall|will do|sure)\b/i;

export function isClientRequestAsRepPromise(p: ExtractedPromise): boolean {
  const q = (p.source_span ?? '').replace(/[’‘]/g, "'");
  return p.owner === 'rep' && q.length > 0 && REQUEST.test(q) && !COMMIT.test(q);
}

/** The running tally: every gate verdict on the deploy ledger that recorded the counter (each gate run once), plus this
 *  gate. Verdicts from before the counter existed are left out, never read as zero. */
export function requestAsPromiseTally(ledger: DeployLedgerEntry[], current: { requestAsPromise: number; fabricated: number }): { cases: number; fabricated: number; gates: number } {
  const seen = new Set<string>();
  let cases = current.requestAsPromise;
  let fabricated = current.fabricated;
  let gates = 1;
  for (const e of ledger) {
    if (e.type !== 'verdict' || typeof e.counters.requestAsPromise !== 'number') continue;
    const key = `${e.sha}|${e.runId}|${e.attempt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cases += e.counters.requestAsPromise;
    fabricated += e.counters.fabricated ?? 0;
    gates += 1;
  }
  return { cases, fabricated, gates };
}
