import { describe, it, expect } from 'vitest';
import { parseFabLedger, poolFabWindow, fabWindowVerdict, formatThisRun, formatPooled, fabRecordLine, LedgerUnreadable, type FabLedgerRecord } from './fab-window.js';

/**
 * [P25-2/3] A fabrication gate that can actually fail in CI. The 1.2% ceiling and the 960-extraction minimum
 * stay (owner ruling, 2 Sep). Every CI gate run — re-runs included — appends a record to an append-only
 * ledger; the gate pools the most recent records with the SAME prompt version + model + extraction
 * fingerprint until ≥ 960 extractions and fails if the pooled rate is over 1.2%. A single gate over 3% fails
 * at once. An empty or unreadable ledger fails CLOSED. And the log line says what actually happened.
 */
const key = { promptVersion: 'tovira-extract-v0.9.7', model: 'claude-sonnet-5', fingerprint: 'fp-A', certFingerprint: 'cert-A' };
const rec = (o: Partial<FabLedgerRecord> & { extractions: number; fabricated: number }): FabLedgerRecord => ({
  type: 'run', sha: 'abc', at: '2026-10-18T12:00:00Z', runId: '1', attempt: 1, ...key, ...o,
});
const ledger = (records: FabLedgerRecord[]) => [JSON.stringify({ type: 'genesis', createdAt: '2026-10-18T00:00:00Z' }), ...records.map((r) => JSON.stringify(r))].join('\n') + '\n';

describe('[P25-2] the ledger store', () => {
  it('parses the genesis line + records in append order', () => {
    const rs = parseFabLedger(ledger([rec({ extractions: 147, fabricated: 1 }), rec({ extractions: 147, fabricated: 0, sha: 'def' })]));
    expect(rs.map((r) => r.sha)).toEqual(['abc', 'def']);
  });
  it('fails CLOSED: an empty file, a missing genesis line, or a corrupt line is unreadable — never "no data, pass"', () => {
    expect(() => parseFabLedger('')).toThrow(LedgerUnreadable);
    expect(() => parseFabLedger(JSON.stringify(rec({ extractions: 147, fabricated: 0 })) + '\n')).toThrow(LedgerUnreadable);
    expect(() => parseFabLedger(ledger([]) + '{not json\n')).toThrow(LedgerUnreadable);
    expect(() => parseFabLedger(ledger([]) + JSON.stringify({ type: 'run', sha: 'x' }) + '\n')).toThrow(LedgerUnreadable); // missing fields
  });
  it('a record line round-trips', () => {
    const r = rec({ extractions: 147, fabricated: 2, runId: '99', attempt: 2 });
    expect(parseFabLedger(ledger([]) + fabRecordLine(r))).toEqual([r]);
  });
});

describe('[P25-2] pooling', () => {
  it('pools the most recent same-key records (this run first) until ≥ 960 extractions', () => {
    const history = Array.from({ length: 8 }, (_, i) => rec({ extractions: 147, fabricated: i === 7 ? 2 : 0, sha: `s${i}` }));
    const w = poolFabWindow(history, key, { extractions: 147, fabricated: 1 }, 960);
    // this run (147) + the 6 most recent records (6×147=882) = 1,029 ≥ 960; the oldest record is not needed
    expect(w).toMatchObject({ runs: 7, extractions: 1029, filled: true });
    expect(w.fabricated).toBe(1 + 2); // s7 (most recent, 2 fab) is inside the window
  });
  it('a fingerprint (or model / prompt-version) change resets the window', () => {
    const history = Array.from({ length: 10 }, () => rec({ extractions: 147, fabricated: 0, fingerprint: 'fp-OLD' }));
    expect(poolFabWindow(history, key, { extractions: 147, fabricated: 0 }, 960)).toMatchObject({ runs: 1, extractions: 147, filled: false });
    const otherModel = Array.from({ length: 10 }, () => rec({ extractions: 147, fabricated: 0, model: 'claude-sonnet-5-5' }));
    expect(poolFabWindow(otherModel, key, { extractions: 147, fabricated: 0 }, 960).runs).toBe(1);
  });
  it('re-runs count: three attempts of one commit are three records in the window', () => {
    const history = [1, 2, 3].map((a) => rec({ extractions: 147, fabricated: a === 3 ? 0 : 3, sha: 'same', runId: '7', attempt: a }));
    const w = poolFabWindow(history, key, { extractions: 147, fabricated: 0 }, 960);
    expect(w.runs).toBe(4);
    expect(w.fabricated).toBe(6); // the failed attempts are not erased by the green one
  });
});

describe('[P25-2] verdict', () => {
  it('a pooled rate above 1.2% fails', () => {
    const v = fabWindowVerdict({ current: { extractions: 147, fabricated: 1 }, pooled: { runs: 7, extractions: 1029, fabricated: 13, filled: true } });
    expect(v.status).toBe('fail');
  });
  it('a pooled rate at or under 1.2% passes', () => {
    expect(fabWindowVerdict({ current: { extractions: 147, fabricated: 1 }, pooled: { runs: 7, extractions: 1029, fabricated: 9, filled: true } }).status).toBe('pass');
  });
  it('a single gate above 3% fails at once, whatever the window says (5/147 = 3.40%)', () => {
    const v = fabWindowVerdict({ current: { extractions: 147, fabricated: 5 }, pooled: { runs: 1, extractions: 147, fabricated: 5, filled: false } });
    expect(v.status).toBe('fail');
    expect(v.reasons.join(' ')).toMatch(/3%/);
    expect(fabWindowVerdict({ current: { extractions: 147, fabricated: 4 }, pooled: { runs: 1, extractions: 147, fabricated: 4, filled: false } }).status).toBe('provisional'); // 2.72% — under the tripwire
  });
  it('a window still filling is provisional — never a pass', () => {
    expect(fabWindowVerdict({ current: { extractions: 147, fabricated: 0 }, pooled: { runs: 4, extractions: 612, fabricated: 0, filled: false } }).status).toBe('provisional');
  });
});

describe('[P25-3] the log line tells the truth (exact wording)', () => {
  it('this run, under / over the ceiling', () => {
    expect(formatThisRun(1, 147)).toBe('fabricated promises: 1/147 (0.68%) — under the 1.2% ceiling');
    expect(formatThisRun(3, 147)).toBe('fabricated promises: 3/147 (2.04%) — over the 1.2% ceiling');
    expect(formatThisRun(0, 147)).toBe('fabricated promises: 0/147 (0.00%) — under the 1.2% ceiling');
  });
  it('this run over the 3% tripwire says so', () => {
    expect(formatThisRun(5, 147)).toBe('fabricated promises: 5/147 (3.40%) — over the 1.2% ceiling and the 3% single-run tripwire');
  });
  it('pooled window: PASS / FAIL / provisional (no pass word while provisional)', () => {
    expect(formatPooled({ runs: 7, extractions: 1029, fabricated: 9, filled: true })).toBe('pooled 9/1,029 (0.87%) over 7 runs — PASS');
    expect(formatPooled({ runs: 7, extractions: 1029, fabricated: 13, filled: true })).toBe('pooled 13/1,029 (1.26%) over 7 runs — FAIL (over the 1.2% ceiling)');
    const prov = formatPooled({ runs: 4, extractions: 612, fabricated: 0, filled: false });
    expect(prov).toBe('pooled 0/612 (0.00%) over 4 runs — provisional (612/960)');
    expect(prov).not.toMatch(/PASS|✓|✔/);
  });
});

import { freshWindowPlan } from './fab-window.js';
describe('[P25-2] owner ruling (18 Oct): when does a fresh window run the in-job full certification?', () => {
  const k = { promptVersion: 'v0.9.7', model: 'claude-sonnet-5', fingerprint: 'narrow-A', certFingerprint: 'cert-A' };
  const r = (o: Partial<FabLedgerRecord>) => rec({ extractions: 147, fabricated: 0, ...k, ...o });
  it('a window that already has ≥ 960 same-key extractions → normal gate (no full cert)', () => {
    expect(freshWindowPlan(Array.from({ length: 7 }, () => r({})), k, 960).mode).toBe('normal');
  });
  it('a code-only change (narrow fingerprint differs, same prompt/model/gate/scorer) → refill from normal gates, provisional', () => {
    const plan = freshWindowPlan([r({ fingerprint: 'narrow-OLD', extractions: 980 })], k, 960);
    expect(plan.mode).toBe('refill');
  });
  it('a prompt-version, model, gate-code or scorer change → the in-job full certification', () => {
    expect(freshWindowPlan([r({ promptVersion: 'v0.9.6', extractions: 980 })], k, 960).mode).toBe('full-cert');
    expect(freshWindowPlan([r({ model: 'claude-sonnet-5-5', extractions: 980 })], k, 960).mode).toBe('full-cert');
    expect(freshWindowPlan([r({ certFingerprint: 'cert-OLD', fingerprint: 'narrow-OLD', extractions: 980 })], k, 960).mode).toBe('full-cert');
  });
  it('a brand-new ledger (genesis only) → full certification first', () => {
    expect(freshWindowPlan([], k, 960).mode).toBe('full-cert');
  });
  it('a full cert already ran for this certification surface (even if its code fingerprint has moved since) → refill, never a second full cert', () => {
    const plan = freshWindowPlan([r({ fingerprint: 'narrow-OLD', extractions: 980 }), r({ fingerprint: 'narrow-OLDER', extractions: 147 })], k, 960);
    expect(plan.mode).toBe('refill');
  });
});

import { type FabStartedRecord } from './fab-window.js';
describe('[P26-3] a gate job that never reports still counts — "started" records', () => {
  const started = (o: Partial<FabStartedRecord> = {}): FabStartedRecord => ({ type: 'started', sha: 'abc', at: '2026-10-19T09:00:00Z', runId: '1', attempt: 1, ...key, ...o });
  const self = { runId: 'self', attempt: 1 };
  const lines = (es: Array<FabLedgerRecord | FabStartedRecord>) => [JSON.stringify({ type: 'genesis', createdAt: '2026-10-18T00:00:00Z' }), ...es.map((e) => JSON.stringify(e))].join('\n') + '\n';

  it('the ledger reads started records alongside results, and rejects a malformed one', () => {
    const es = parseFabLedger(lines([started({ runId: '9' }), rec({ extractions: 147, fabricated: 0, runId: '9' })]));
    expect(es.map((e) => e.type)).toEqual(['started', 'run']);
    expect(() => parseFabLedger(lines([]) + JSON.stringify({ type: 'started', sha: 'x' }) + '\n')).toThrow(LedgerUnreadable);
  });

  it('a started run that reported its result changes nothing', () => {
    const es = [...Array.from({ length: 7 }, (_, i) => [started({ runId: `r${i}` }), rec({ extractions: 147, fabricated: 0, runId: `r${i}` })]).flat()];
    const w = poolFabWindow(es, key, { extractions: 147, fabricated: 0 }, 960, self);
    expect(w.unreported).toEqual([]);
    expect(fabWindowVerdict({ current: { extractions: 147, fabricated: 0 }, pooled: w }).status).toBe('pass');
  });

  it('a started record with no matching result, inside the window, FAILS it', () => {
    const es = [
      ...Array.from({ length: 6 }, (_, i) => [started({ runId: `r${i}` }), rec({ extractions: 147, fabricated: 0, runId: `r${i}` })]).flat(),
      started({ runId: 'cancelled', attempt: 2, sha: 'deadbee' }), // cancelled before scoring — no result line
    ];
    const w = poolFabWindow(es, key, { extractions: 147, fabricated: 0 }, 960, self);
    expect(w.unreported).toEqual([{ runId: 'cancelled', attempt: 2, sha: 'deadbee' }]);
    const v = fabWindowVerdict({ current: { extractions: 147, fabricated: 0 }, pooled: w });
    expect(v.status).toBe('fail');
    expect(v.reasons.join(' ')).toMatch(/cancelled\/2 .*started .*never reported/);
    expect(formatPooled(w)).toBe('pooled 0/1,029 (0.00%) over 7 runs — FAIL (1 run started and never reported)');
  });

  it('…and a window still filling that holds one is a FAIL too, not provisional', () => {
    const w = poolFabWindow([started({ runId: 'gone' })], key, { extractions: 147, fabricated: 0 }, 960, self);
    expect(fabWindowVerdict({ current: { extractions: 147, fabricated: 0 }, pooled: w }).status).toBe('fail');
  });

  it('a re-run attempt reports, but the cancelled attempt before it still counts (attempts are matched exactly)', () => {
    const es = [started({ runId: '7', attempt: 1 }), started({ runId: '7', attempt: 2 }), rec({ extractions: 147, fabricated: 0, runId: '7', attempt: 2 })];
    expect(poolFabWindow(es, key, { extractions: 147, fabricated: 0 }, 960, self).unreported).toEqual([{ runId: '7', attempt: 1, sha: 'abc' }]);
  });

  it('this job\'s own started record is not "unreported" — it is reporting now', () => {
    const w = poolFabWindow([started({ runId: 'self', attempt: 1 })], key, { extractions: 147, fabricated: 0 }, 960, self);
    expect(w.unreported).toEqual([]);
  });

  it('an unreported start older than the window (≥ 960 newer extractions) has aged out; another key\'s never counts', () => {
    const newer = Array.from({ length: 7 }, (_, i) => rec({ extractions: 147, fabricated: 0, runId: `n${i}` }));
    expect(poolFabWindow([started({ runId: 'old' }), ...newer], key, { extractions: 147, fabricated: 0 }, 960, self).unreported).toEqual([]);
    expect(poolFabWindow([started({ runId: 'x', fingerprint: 'fp-OTHER' })], key, { extractions: 147, fabricated: 0 }, 960, self).unreported).toEqual([]);
  });

  it('started-only records never make a certification surface look "already gated" (a cancelled full cert is re-run)', () => {
    expect(freshWindowPlan([started({ extractions: undefined } as Partial<FabStartedRecord>)], key, 960).mode).toBe('full-cert');
  });

  it('the started line round-trips', () => {
    const s = started({ runId: '42', attempt: 3 });
    expect(parseFabLedger(lines([]) + fabStartedLine(s))).toEqual([s]);
  });
});
import { fabStartedLine } from './fab-window.js';
