import { describe, it, expect } from 'vitest';
import { CORPUS, evaluateCase } from './redaction-corpus.js';

/**
 * [REDACT-MEASURE] Regression FLOOR for redaction accuracy. This is not the measurement (see
 * redaction-accuracy.test.ts, which prints the report). This guard pins the measured result so it can
 * only get BETTER, never quietly worse — in BOTH directions:
 *   1. every case that is currently CAUGHT (a real identifier removed) must stay caught, and
 *   2. every control that currently PASSES (survives untouched) must keep passing — no new false positive.
 * An improvement (a documented gap starting to catch, an FP starting to pass) does NOT fail this guard;
 * when that happens, remove the id from KNOWN_GAPS below so the win is locked in as the new floor.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * CAVEAT — READ BEFORE QUOTING ANY NUMBER FROM HERE:
 * The corpus this floor is built on is DELIBERATELY ADVERSARIAL. It is a hand-picked coverage set that
 * over-weights the known failure modes (bare unlabelled values, labels separated from their value, cross-
 * message splits, unusual/Arabic labels). Its miss rate is therefore NOT a production miss rate and must
 * never be reported as one — a real message stream is dominated by the labelled/format-anchored shapes
 * that this detector handles well. This floor exists to catch REGRESSIONS, not to describe field accuracy.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * BASELINE PINNED 2026-09-27 (corpus n=65). Measured at pin time:
 *   format-anchored 5/21 missed (24%) · keyword-anchored 13/25 missed (52%) · controls 1/19 FP (5%).
 * KNOWN_GAPS = the 18 misses + 1 false positive present at pin time. Every OTHER case must be correct.
 * Each id is a documented gap from the accuracy report; see redaction-corpus.ts for the case + its note.
 */
const KNOWN_GAPS: ReadonlySet<string> = new Set([
  // format-anchored misses (5)
  'eid-spaces',        // SPACE separators — pattern only tolerated dashes
  'eid-split-msg2',    // EID tail sent as its own message (cross-message)
  'card-typo',         // fails Luhn (a real transposed digit)
  'card-split-msg2',   // card half sent as its own message (cross-message)
  'card-newline',      // digits split across a line break within one message
  // keyword-anchored misses (13)
  'pass-bare',         // bare passport value, no label
  'pass-separated',    // label separated from value by words
  'pass-arabic-label', // Arabic label (جواز السفر)
  'acct-bare',         // bare account number, no label
  'acct-separated',    // label separated from value by words
  'acct-acct',         // unenumerated label "acct"
  'acct-arabic',       // Arabic label (رقم الحساب)
  'acct-crossmsg',     // value sent as its own message (cross-message)
  'cred-bare',         // bare OTP-looking value, no label
  'cred-separated',    // only bare "code", separated
  'cred-arabic',       // Arabic label (الرمز)
  'swift-bare',        // bare BIC, no label
  'swift-arabic',      // Arabic label (سويفت)
  // false positive (1)
  'ctl-tradelicence',  // "trade licence 654321" wrongly caught by the passport/licence detector
]);

describe('[REDACT-MEASURE] redaction accuracy regression floor (pinned 2026-09-27)', () => {
  it('every non-gap redact case stays CAUGHT and every non-gap control keeps PASSING (both directions)', () => {
    const regressions: string[] = [];
    for (const c of CORPUS) {
      if (KNOWN_GAPS.has(c.id)) continue; // documented gap at pin time — not part of the floor
      const { caught, redacted } = evaluateCase(c);
      if (!caught) {
        const dir = c.expect === 'redact'
          ? `MISS: identifier "${c.value}" left in the text`
          : `FALSE POSITIVE: control was redacted`;
        regressions.push(`  [${c.id}] ${dir}\n      input:  "${c.input.replace(/\n/g, '\\n')}"\n      output: "${redacted.replace(/\n/g, '\\n')}"`);
      }
    }
    if (regressions.length > 0) {
      throw new Error(
        `Redaction regressed below the 2026-09-27 floor — ${regressions.length} case(s) that were correct are now broken:\n${regressions.join('\n')}\n` +
        `\nIf this is an intended detector change, do NOT silence it here: fix the detector, or (only for a case newly moved into a documented gap) update KNOWN_GAPS with a dated note.`,
      );
    }
    expect(regressions).toHaveLength(0);
  });

  it('KNOWN_GAPS only lists real corpus ids (no stale entry hiding a fixed case as still-broken)', () => {
    const ids = new Set(CORPUS.map((c) => c.id));
    const stale = [...KNOWN_GAPS].filter((id) => !ids.has(id));
    expect(stale, `KNOWN_GAPS references ids not in the corpus: ${stale.join(', ')}`).toHaveLength(0);
  });
});
