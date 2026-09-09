import { describe, it, expect } from 'vitest';
import { IMPORT_FIXTURES, synthTranscript, type InvariantFixture } from './import-fixtures.js';
import { scoreInvariants, type InvariantContract } from './score-invariants.js';
import type { Extraction } from '../services/extraction/types.js';
import { parseWhatsAppExport } from '../services/import/whatsapp.js';

const EMPTY: Extraction = { summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null };

/** Build a result that SATISFIES a contract — used to prove the wired contracts don't false-fail. */
function compliantActual(c: InvariantContract): Extraction {
  return {
    ...EMPTY,
    promises: (c.requiredPromises ?? []).map((rp) => ({ text: rp.match, owner: 'rep' as const, due_date: typeof rp.dueYear === 'number' ? `${rp.dueYear}-06-15` : null, due_raw: null, confidence: 'low' as const })),
    people: (c.requiredPeople ?? []).map((rp) => ({ name: rp.name, role: null, reports_to: null, decision_role: rp.decisionRole ?? 'unknown', notes: null })),
    key_dates: (c.requiredDates ?? []).map((rd) => ({ description: rd.match, date: typeof rd.year === 'number' ? `${rd.year}-06-15` : null, date_raw: null, type: 'other' })),
  };
}

/**
 * [GATE-IMPORT-SIZE] CONSISTENCY pass — the "check each anchor is actually planted" step Wabil asked
 * for before any certification spend. A fixture whose transcript doesn't contain an anchor it asserts
 * would fail the gate for the WRONG reason (a reworded fact), which is exactly what you don't want to
 * discover mid-certification. So: every anchor a contract/expected asserts must appear in that
 * fixture's transcript, the transcripts must parse, and the sizes must be in the intended regime.
 */
const inText = (transcript: string, needle: string): boolean => transcript.toLowerCase().includes(needle.toLowerCase());

describe('[GATE-IMPORT-SIZE] import fixtures are internally consistent', () => {
  it('every fixture transcript parses as a WhatsApp export with messages', () => {
    for (const f of IMPORT_FIXTURES) {
      const p = parseWhatsAppExport(f.transcript);
      expect(p.ok, `${f.id} should parse`).toBe(true);
      if (p.ok) expect(p.messages.length, `${f.id} has messages`).toBeGreaterThan(0);
    }
  });

  it('fixtures sit in their intended size regime (message count)', () => {
    const size = (id: string) => { const p = parseWhatsAppExport(IMPORT_FIXTURES.find((f) => f.id === id)!.transcript); return p.ok ? p.messages.length : 0; };
    expect(size('import-easy-omar')).toBeGreaterThanOrEqual(20);
    expect(size('import-medium-farah')).toBeGreaterThanOrEqual(350);
    expect(size('import-hard-imtinan')).toBeGreaterThanOrEqual(5000);
  });

  it('every asserted anchor (required + trap material) appears in its transcript', () => {
    for (const f of IMPORT_FIXTURES.filter((x): x is InvariantFixture => x.mode === 'invariant')) {
      const c = f.contract;
      for (const rp of c.requiredPromises ?? []) expect(inText(f.transcript, rp.match), `${f.id}: required promise "${rp.match}"`).toBe(true);
      for (const rp of c.requiredPeople ?? []) expect(inText(f.transcript, rp.name), `${f.id}: required person "${rp.name}"`).toBe(true);
      for (const rd of c.requiredDates ?? []) expect(inText(f.transcript, rd.match), `${f.id}: required date "${rd.match}"`).toBe(true);
      // Trap material MUST be present, or the trap tests nothing.
      for (const fp of c.forbiddenPromises ?? []) expect(inText(f.transcript, fp.match), `${f.id}: retracted-promise material "${fp.match}"`).toBe(true);
      for (const e of c.forbiddenEntities ?? []) expect(inText(f.transcript, e), `${f.id}: forbidden-entity material "${e}"`).toBe(true);
    }
  });

  it('HARD fixture spans 2019 → 2024 (multi-year anchors present)', () => {
    const f = IMPORT_FIXTURES.find((x) => x.id === 'import-hard-imtinan')!;
    for (const year of ['2019', '2021', '2023', '2024']) expect(inText(f.transcript, `/${year},`), `year ${year} present`).toBe(true);
  });

  // Tie the two-class proof to the ACTUAL fixture contracts that will gate. Under the ruled policy an
  // empty result is a RECALL collapse (reported), not a per-run gate failure — so it must NOT gate
  // (wrongness empty, passed=true) yet must be DETECTED (anchorsFound 0, recall misses reported).
  it('each real invariant contract reports an empty extraction as a recall collapse, without gating', () => {
    for (const f of IMPORT_FIXTURES.filter((x): x is InvariantFixture => x.mode === 'invariant')) {
      const r = scoreInvariants(f.contract, EMPTY);
      expect(r.wrongness, `${f.id}: an empty result asserts nothing WRONG`).toEqual([]);
      expect(r.passed, `${f.id}: so the per-run gate passes`).toBe(true);
      expect(r.anchorsFound, `${f.id}: but recall shows the collapse`).toBe(0);
      expect(r.recallMisses.length, `${f.id}: and the misses are reported`).toBeGreaterThan(0);
    }
  });

  it('each real invariant contract PASSES a result built to satisfy it (no false-fail)', () => {
    for (const f of IMPORT_FIXTURES.filter((x): x is InvariantFixture => x.mode === 'invariant')) {
      const r = scoreInvariants(f.contract, compliantActual(f.contract));
      expect(r.violations, `${f.id} should pass a compliant result`).toEqual([]);
    }
  });

  it('synthTranscript is deterministic (same seed → identical output)', () => {
    const opts = { client: 'X', anchors: [{ date: '01/01/2020', time: '10:00', sender: 'Me', text: 'anchor' }], totalMessages: 50, years: [2020], seed: 7 };
    expect(synthTranscript(opts)).toBe(synthTranscript(opts));
  });
});
