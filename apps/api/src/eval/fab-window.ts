import { GATE_FAB } from './gate.js';

/**
 * [P25-2/3] The rolling fabrication window — the reason the CI gate can now FAIL on fabrication.
 *
 * The 1.2% ceiling needs ≥ 960 extractions to mean anything (owner ruling, 2 Sep), and one CI gate is 147,
 * so on its own every gate was "provisional" and the bar could never fail. Now every CI gate run — re-runs
 * included — appends a record to an append-only ledger, and the gate POOLS this run with the most recent
 * records that share its prompt version + model + extraction fingerprint until there are ≥ 960 extractions,
 * then fails if the pooled rate is over the ceiling. A change to any of the three starts the window fresh.
 * A single gate over the 3% tripwire fails at once, whatever the window says. The ledger must be readable and
 * start with a genesis line: an empty, missing or corrupt ledger FAILS CLOSED (it never reads as "no data").
 */
export const FAB_TRIPWIRE_PCT = 3;

export interface FabWindowKey {
  promptVersion: string;
  model: string;
  /** The narrow extraction-code fingerprint — the window key: any change starts a fresh window. */
  fingerprint: string;
  /** [owner ruling 18 Oct] The certification surface (certified prompt + gate + scorer + eval set): a change
   *  here — or to the prompt version / model — makes the next gate run the in-job ≥ 960 full certification. */
  certFingerprint: string;
}
export interface FabLedgerRecord extends FabWindowKey {
  type: 'run';
  sha: string;
  at: string;
  runId: string;
  attempt: number;
  extractions: number;
  fabricated: number;
}
export interface FabCount { extractions: number; fabricated: number }
export interface FabWindow extends FabCount { runs: number; filled: boolean }
export type FabVerdict = { status: 'pass' | 'fail' | 'provisional'; reasons: string[] };

export class LedgerUnreadable extends Error {}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Parse the JSONL ledger. Throws LedgerUnreadable on anything it cannot vouch for (fail closed). */
export function parseFabLedger(text: string): FabLedgerRecord[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new LedgerUnreadable('the fabrication ledger is empty (no genesis line) — failing closed');
  const parse = (l: string, i: number): Record<string, unknown> => {
    try { return JSON.parse(l) as Record<string, unknown>; } catch { throw new LedgerUnreadable(`ledger line ${i + 1} is not valid JSON — failing closed`); }
  };
  if (parse(lines[0]!, 0).type !== 'genesis') throw new LedgerUnreadable('the fabrication ledger has no genesis line — failing closed');
  return lines.slice(1).map((l, i) => {
    const o = parse(l, i + 1);
    const ok = o.type === 'run' && isStr(o.sha) && isStr(o.at) && isStr(o.runId) && isCount(o.attempt) && isCount(o.extractions) && isCount(o.fabricated)
      && isStr(o.promptVersion) && isStr(o.model) && isStr(o.fingerprint) && isStr(o.certFingerprint) && (o.fabricated as number) <= (o.extractions as number);
    if (!ok) throw new LedgerUnreadable(`ledger line ${i + 2} is not a valid run record — failing closed`);
    return o as unknown as FabLedgerRecord;
  });
}

/** One ledger line for this run (what CI appends). */
export function fabRecordLine(r: FabLedgerRecord): string {
  const { type, sha, at, runId, attempt, extractions, fabricated, promptVersion, model, fingerprint, certFingerprint } = r;
  return JSON.stringify({ type, sha, at, runId, attempt, extractions, fabricated, promptVersion, model, fingerprint, certFingerprint }) + '\n';
}

const sameKey = (r: FabWindowKey, k: FabWindowKey): boolean =>
  r.promptVersion === k.promptVersion && r.model === k.model && r.fingerprint === k.fingerprint && r.certFingerprint === k.certFingerprint;
const sameCertSurface = (r: FabWindowKey, k: FabWindowKey): boolean =>
  r.promptVersion === k.promptVersion && r.model === k.model && r.certFingerprint === k.certFingerprint;

export type FreshWindowMode = 'normal' | 'refill' | 'full-cert';
/**
 * [owner ruling, 18 Oct] What this CI gate must do before it runs:
 *  - normal    — the same-key window already holds ≥ min extractions;
 *  - refill    — a code-only change (narrow fingerprint) on a certification surface that has already been
 *                gated: the fresh window refills from ordinary gates (provisional; the 3% tripwire applies);
 *  - full-cert — the prompt version, model, gate code or scorer changed (or the ledger is new): this job runs
 *                the full ≥ min-extraction certification itself.
 */
export function freshWindowPlan(records: FabLedgerRecord[], key: FabWindowKey, min: number = GATE_FAB.minExtractions): { mode: FreshWindowMode; sameKeyExtractions: number } {
  const sameKeyExtractions = records.filter((r) => sameKey(r, key)).reduce((n, r) => n + r.extractions, 0);
  if (sameKeyExtractions >= min) return { mode: 'normal', sameKeyExtractions };
  return { mode: records.some((r) => sameCertSurface(r, key)) ? 'refill' : 'full-cert', sameKeyExtractions };
}

/** This run + the most recent same-key records (newest first) until ≥ min extractions. Every record counts —
 *  a re-run's failed attempts stay in the window; nothing is skipped or deduplicated. */
export function poolFabWindow(records: FabLedgerRecord[], key: FabWindowKey, current: FabCount, min: number = GATE_FAB.minExtractions): FabWindow {
  const w: FabWindow = { runs: 1, extractions: current.extractions, fabricated: current.fabricated, filled: current.extractions >= min };
  for (let i = records.length - 1; i >= 0 && !w.filled; i--) {
    const r = records[i]!;
    if (!sameKey(r, key)) continue;
    w.runs += 1;
    w.extractions += r.extractions;
    w.fabricated += r.fabricated;
    w.filled = w.extractions >= min;
  }
  return w;
}

const pct = (f: number, n: number): number => (n === 0 ? 0 : (f / n) * 100);

/** pass / fail / provisional. Provisional is never a pass; the 3% tripwire fails regardless of the window. */
export function fabWindowVerdict(input: { current: FabCount; pooled: FabWindow; ceilingPct?: number; tripwirePct?: number }): FabVerdict {
  const ceiling = input.ceilingPct ?? GATE_FAB.maxRatePct;
  const tripwire = input.tripwirePct ?? FAB_TRIPWIRE_PCT;
  const reasons: string[] = [];
  const runRate = pct(input.current.fabricated, input.current.extractions);
  if (runRate > tripwire) reasons.push(`this run fabricated ${input.current.fabricated}/${input.current.extractions} (${runRate.toFixed(2)}%) — over the ${tripwire}% single-run tripwire`);
  const poolRate = pct(input.pooled.fabricated, input.pooled.extractions);
  if (input.pooled.filled && poolRate > ceiling) reasons.push(`pooled ${input.pooled.fabricated}/${input.pooled.extractions} (${poolRate.toFixed(2)}%) over ${input.pooled.runs} runs — over the ${ceiling}% ceiling`);
  if (reasons.length > 0) return { status: 'fail', reasons };
  return { status: input.pooled.filled ? 'pass' : 'provisional', reasons };
}
