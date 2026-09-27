import { describe, it, expect } from 'vitest';
import { CORPUS, evaluateCase, type CaseOutcome, type RedactionCase } from './redaction-corpus.js';

/**
 * [REDACT-MEASURE] Runs the labelled corpus through redactSensitive and prints the accuracy report
 * (per kind + per group, every miss and false positive verbatim). This test MEASURES; it does not gate
 * on the numbers — the baseline guard (redaction-baseline.test.ts) pins the result. Console output is the artifact.
 * Classification (caught/miss/FP) uses the shared evaluateCase, so the report and the guard agree exactly.
 */
type Outcome = CaseOutcome;

describe('[REDACT-MEASURE] redaction accuracy against the labelled corpus', () => {
  it('measures and prints the report (misses + false positives verbatim)', () => {
    const outcomes = CORPUS.map(evaluateCase);
    const KINDS: Array<RedactionCase['kind']> = ['emirates_id', 'iban', 'card', 'passport', 'bank_account', 'credential', 'swift'];
    const rows: string[] = [];
    const misses: Outcome[] = [];
    const fps: Outcome[] = [];

    for (const kind of KINDS) {
      const redactCases = outcomes.filter((o) => o.c.kind === kind && o.c.expect === 'redact');
      const missed = redactCases.filter((o) => !o.caught);
      // FPs attributable to this kind's detector: a control the detector fired on.
      const kindFps = outcomes.filter((o) => o.c.kind === 'control' && o.firedKinds.includes(kind));
      const n = redactCases.length;
      const missRate = n ? ((missed.length / n) * 100).toFixed(0) : '-';
      rows.push(`  ${kind.padEnd(13)} n=${String(n).padStart(2)}  misses=${String(missed.length).padStart(2)} (${missRate}%)   FPs=${kindFps.length}`);
      misses.push(...missed);
      for (const f of kindFps) if (!fps.includes(f)) fps.push(f);
    }
    const controls = outcomes.filter((o) => o.c.kind === 'control');
    const controlFps = controls.filter((o) => !o.caught); // caught===false for a control means it was redacted (FP)
    for (const f of controlFps) if (!fps.includes(f)) fps.push(f);

    const grp = (g: RedactionCase['group']) => {
      const cs = outcomes.filter((o) => o.c.group === g && o.c.expect === 'redact');
      const m = cs.filter((o) => !o.caught).length;
      return cs.length ? `${m}/${cs.length} missed (${((m / cs.length) * 100).toFixed(0)}%)` : 'n/a';
    };

    console.log(`\n================ REDACTION ACCURACY REPORT (corpus n=${CORPUS.length}) ================`);
    console.log('Per identifier kind (misses = a real identifier left in the text; FPs = a control wrongly redacted):');
    console.log(rows.join('\n'));
    console.log('\nGrouped:');
    console.log(`  FORMAT-ANCHORED (Emirates ID, IBAN, card): ${grp('format-anchored')}`);
    console.log(`  KEYWORD-ANCHORED (passport, bank account, credential, SWIFT): ${grp('keyword-anchored')}`);
    console.log(`  CONTROLS (must NOT be caught): ${controlFps.length}/${controls.length} false positives (${((controlFps.length / controls.length) * 100).toFixed(0)}%)`);

    console.log(`\n---- EVERY MISS (${misses.length}) — verbatim input → what happened ----`);
    for (const o of misses) console.log(`  [${o.c.kind}${o.c.crossMessage ? '/cross-msg' : ''}] "${o.c.input.replace(/\n/g, '\\n')}"  (${o.c.note})\n      → left as: "${o.redacted.replace(/\n/g, '\\n')}"`);

    console.log(`\n---- EVERY FALSE POSITIVE (${controlFps.length}) — verbatim input → what it became ----`);
    if (controlFps.length === 0) console.log('  (none)');
    for (const o of controlFps) console.log(`  [fired: ${o.firedKinds.join(',')}] "${o.c.input}"  (${o.c.note})\n      → became: "${o.redacted}"`);
    console.log('==========================================================================\n');

    // Not a numeric gate (Task 3 pins the baseline). Only assert the measurement ran over the whole corpus.
    expect(outcomes).toHaveLength(CORPUS.length);
    expect(CORPUS.length).toBeGreaterThan(40);
  });
});
