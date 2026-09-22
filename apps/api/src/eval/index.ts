import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { extractForEval, extractImportFixture, evaluateGate, softGate, fabricationGate, tier1Residual, requirementsGate, structuredSensitiveCount, GATE_FAB, GATE_TIER2, GATE_REQ } from './gate.js';
import { classifyLeaks, tier2Bars, tier2ClassOf, type LeakRecord, type Tier2Class } from './tier2-classify.js';
import { IMPORT_FIXTURES, RECALL_BASELINES } from './import-fixtures.js';
import { scoreInvariants } from './score-invariants.js';
import { redactSensitive } from '../services/redaction/redact.js';
import { EVAL_NOTES, type EvalNote } from './eval-set.js';
import { scoreNote, aggregate, scoreReceipts, aggregateReceipts, GATE_RECEIPTS, type NoteScore, type ReceiptScore } from './score.js';
import type { Extraction } from '../services/extraction/types.js';
import type { ModelClient } from '../ports/model.js';
import { ModelBudget } from '../services/metrics/model-budget.js';

/**
 * The P1-9 quality gate under the redefined standard (temperature is deprecated
 * for claude-sonnet-5, so its own low-variance sampling is used):
 *   HARD (per-run, every subset, zero tolerance): 0 guessed dates · 0 fabricated
 *     promises · 0 merged people.
 *   SOFT (aggregate over 3 runs): promises recall ≥ 0.9 · people precision ≥ 0.85
 *     · people recall ≥ 0.8.
 * Runs the eval 3× and reports per-run numbers + the 3-run aggregate. Also names
 * any spurious (fp) person — the people-precision culprit. Exits non-zero on any
 * failure.
 */
const p = (n: number): string => n.toFixed(2);

interface Scored { note: EvalNote; actual: Extraction | null; score: NoteScore; receipt: ReceiptScore }

async function runOnce(model: ModelClient): Promise<Scored[]> {
  const out: Scored[] = [];
  for (const note of EVAL_NOTES) {
    const actual = await extractForEval(model, note, { aliases: note.aliases });
    // Thread `forbidden` so the gate actually measures leakedValues (REDACT-5 bar = 0);
    // without it the leakage metric is dark and the HARD leak check can never fire.
    // [RECEIPTS-v0.9.5 Task 5] Score receipts against the source: only an imported chat carries
    // per-message timestamps, so voice/paste must leave source_message_at null (Rule 9).
    const receipt = scoreReceipts(note.note, actual, note.source === 'whatsapp_export');
    out.push({ note, actual, score: scoreNote(note.expected, actual, note.mustNotMerge, note.forbidden), receipt });
  }
  return out;
}

function line(label: string, m: ReturnType<typeof aggregate>, verdict: string): void {
  console.log(`[gate]   ${label}: promises p=${p(m.promises.precision)} r=${p(m.promises.recall)} · people p=${p(m.people.precision)} r=${p(m.people.recall)} · guessed=${m.guessedDates} merged=${m.mergedPeople} falseCert=${m.falseCertainties} leaked=${m.leakedValues} nullNamed=${m.nullNamedPeople} · fab=${m.fabricatedPromises} (aggregate bar) → ${verdict}`);
}

// REQ-GATE (v0.9.3): requirements PRECISION is gated (floor GATE_REQ.floorPct), recall is measured
// and reported — a false requirement is a wrong pitch in front of a client (§4), a missed one is
// invisible. dateErr is the Rule 8 / DATE-REF stated_on check; confInfl is a conditional need
// returned as firm; reqFP is the false-positive count that precision is computed from.
function reqLine(label: string, m: ReturnType<typeof aggregate>): void {
  const g = requirementsGate(m, 'agg');
  const verdict = g.provisional ? `PROVISIONAL (scored ${g.scored}<${GATE_REQ.minScored})` : g.passed ? `PASS (≥${GATE_REQ.floorPct}% floor)` : `FAIL: ${g.reasons.join('; ')}`;
  console.log(`[gate]   ${label} requirements: precision ${g.precisionPct.toFixed(1)}% (GATED, floor ${GATE_REQ.floorPct}%) · recall ${g.recallPct.toFixed(1)}% (measured) · reqFP=${m.requirementFalsePositives} · dateErr=${m.requirementDateErrors} · confInfl=${m.requirementConfInflation} → ${verdict}`);
}

function spuriousPeople(scored: Scored[]): void {
  for (const { note, actual } of scored) {
    const expected = new Set((note.expected.people ?? []).map((x) => (x.name ?? '').trim().toLowerCase()).filter(Boolean));
    for (const x of (actual?.people ?? []).filter((y) => !expected.has((y.name ?? '').trim().toLowerCase()))) {
      console.log(`[gate]   people fp in "${note.id}": predicted "${x.name ?? '∅'}"${x.role ? ` (${x.role})` : ''} — expected: [${[...expected].join(', ') || '∅'}]`);
    }
  }
}

// REQ-CERT: name every requirement false positive — the concern↔requirement leak — so the
// baseline is diagnostic, not just a number. A note whose score has requirements.fp>0 has a
// predicted requirement that matched no expected one; print each so we can see WHICH fixture and
// WHAT phrase the model wrongly promoted to a stated need (a concern, question or speculation).
function spuriousRequirements(scored: Scored[]): void {
  for (const { note, actual, score } of scored) {
    if (score.requirements.fp === 0) continue;
    const expected = (note.expected.requirements ?? []).map((r) => r.requirement_raw);
    for (const r of actual?.requirements ?? []) {
      console.log(`[gate]   requirement fp in "${note.id}": predicted "${r.text}" ⟵ raw "${r.requirement_raw}" — expected reqs: [${expected.join(' | ') || '∅ (boundary: should be none)'}]`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const modelId = config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
  // Wrap the real client so the gate reports its own cache health + spend (the discipline:
  // warm the prefix, then confirm it's actually being read, and know what the run cost).
  const realModel = createModelClient(config);
  const budget = new ModelBudget(2.0, 0.5);
  let calls = 0;
  let hits = 0;
  const model: ModelClient = {
    complete: async (req) => {
      const res = await realModel.complete(req);
      const u = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      budget.record('extraction', modelId, u);
      calls += 1;
      if ((u.cacheReadInputTokens ?? 0) > 0) hits += 1;
      return res;
    },
  };
  const allScores: NoteScore[] = [];
  const allReceipts: ReceiptScore[] = [];
  // [TIER2-SPLIT] every Tier-2 leak, attributed to fixture/term/field/class/run, so the bars can be
  // split per class and each leak named. Health is excluded — it has its own structured/free-text bars.
  const leakRecords: Array<LeakRecord & { run: number }> = [];
  let hardPassed = true;

  // Runs are configurable: 3 (default) is the cheap per-run/soft deploy gate; a fabrication
  // CERTIFICATION needs GATE_RUNS high enough to clear GATE_FAB.minExtractions (~15 = 480).
  const RUNS = Math.max(1, Number(process.env.GATE_RUNS ?? 3));
  for (const run of Array.from({ length: RUNS }, (_, i) => i + 1)) {
    console.log(`\n[gate] === RUN ${run} — model: ${modelId} (default sampling; temperature deprecated) ===`);
    const scored = await runOnce(model);
    const full = aggregate(scored.map((s) => s.score));
    const ml = aggregate(scored.filter((s) => s.note.multilingual).map((s) => s.score));
    const fullGate = evaluateGate(full, modelId);
    const mlGate = evaluateGate(ml, modelId);
    line('FULL SET   ', full, fullGate.passed ? 'HARD PASS' : `HARD FAIL: ${fullGate.reasons.join('; ')}`);
    line('MULTILINGUAL', ml, mlGate.passed ? 'HARD PASS' : `HARD FAIL: ${mlGate.reasons.join('; ')}`);
    if (run === 1) { spuriousPeople(scored); spuriousRequirements(scored); }
    for (const s of scored) {
      if (s.note.id === 'health-exclusion') continue; // health has its own bars, not the Tier-2 split
      for (const rec of classifyLeaks(s.note.id, s.note.forbidden ?? [], s.actual)) leakRecords.push({ ...rec, run });
    }
    allScores.push(...scored.map((s) => s.score));
    allReceipts.push(...scored.map((s) => s.receipt));
    hardPassed &&= fullGate.passed && mlGate.passed;
  }

  // [RECEIPTS-v0.9.5 Task 5] Receipt gate: a fabricated source_span is as serious as a fabricated
  // date (Rule 9), and source_message_at on an ambiguous (voice/paste) source is a wrong fact —
  // both per-run zero-tolerance. Checked automatically here instead of via a manual cert report.
  const receiptAgg = aggregateReceipts(allReceipts);
  const receiptPass =
    receiptAgg.spansFabricated <= GATE_RECEIPTS.maxFabricatedSpans &&
    receiptAgg.messageAtOnAmbiguous <= GATE_RECEIPTS.maxMessageAtOnAmbiguous;
  console.log(
    `[gate]   RECEIPTS: spans emitted=${receiptAgg.spansEmitted} FABRICATED=${receiptAgg.spansFabricated} (bar ${GATE_RECEIPTS.maxFabricatedSpans}) · ` +
      `msgAt-on-ambiguous=${receiptAgg.messageAtOnAmbiguous} (bar ${GATE_RECEIPTS.maxMessageAtOnAmbiguous}) · msgAt-not-in-source=${receiptAgg.messageAtNotInSource} (reported) → ${receiptPass ? 'HARD PASS' : 'HARD FAIL'}`,
  );
  hardPassed &&= receiptPass;

  const agg = aggregate(allScores);
  const soft = softGate(agg, modelId);
  console.log(`\n[gate] === ${RUNS}-RUN AGGREGATE (soft bars + fabrication rate) ===`);
  line('AGGREGATE  ', agg, soft.passed ? 'SOFT PASS' : `SOFT FAIL: ${soft.reasons.join('; ')}`);
  reqLine('AGGREGATE  ', agg);

  // Fabrication: aggregate rate bar (owner ruling). Only a non-provisional pass certifies.
  const fab = fabricationGate(agg, modelId);
  const runsToCertify = Math.ceil(GATE_FAB.minExtractions / EVAL_NOTES.length);
  const fabState = fab.provisional
    ? `PROVISIONAL (${agg.fabricatedPromises}/${fab.extractions} = ${fab.ratePct.toFixed(2)}% ≤ ${GATE_FAB.maxRatePct}%, but N<${GATE_FAB.minExtractions} — run GATE_RUNS=${runsToCertify} to certify)`
    : fab.passed
      ? `CERTIFIED (${agg.fabricatedPromises}/${fab.extractions} = ${fab.ratePct.toFixed(2)}% ≤ ${GATE_FAB.maxRatePct}% tripwire; published rate ${GATE_FAB.certifiedRatePct}% from N=${GATE_FAB.justifyingN})`
      : `FAIL: ${fab.reasons.join('; ')}`;
  console.log(`[gate]   FABRICATION: ${fabState}`);

  // LEAKAGE — reported as TWO distinct guarantees, never one number (owner condition).
  // TIER-1 (format): deterministic, ingest-enforced, per-run ZERO. Verified without the model.
  const tier1Bad = tier1Residual(EVAL_NOTES);
  const tier1Pass = tier1Bad.length === 0;
  console.log(`[gate]   TIER-1 LEAKAGE: ${tier1Pass ? '0 — deterministically enforced at ingest (redact.ts idempotent; no residual pattern)' : `FAIL — redact.ts left a residual Tier-1 pattern in: ${tier1Bad.join(', ')}`}`);

  // [TIER2-SPLIT] Tier-2 leakage, SPLIT PER CLASS so one class can never be hidden by, or blamed on,
  // another. A fixture is Tier-2 when a forbidden term survives ingest redaction; exposures per class =
  // (non-health Tier-2 fixtures in that class) × runs. The SPECIAL-CATEGORY bar (religion / ethnicity /
  // politics / sexual orientation) is the privacy GATE; alias-normalisation and 'other' are reported,
  // not gated — an echoed alias is a quality miss, not a privacy leak, and must never fail the privacy bar.
  const t2Fixtures = EVAL_NOTES.filter((n) => n.id !== 'health-exclusion' && (n.forbidden ?? []).some((f) => redactSensitive(n.note).redacted.includes(f)));
  const exposuresByClass: Partial<Record<Tier2Class, number>> = {};
  for (const n of t2Fixtures) { const c = tier2ClassOf(n.id); exposuresByClass[c] = (exposuresByClass[c] ?? 0) + RUNS; }
  const bars = tier2Bars(leakRecords, exposuresByClass, GATE_TIER2.minExposures, GATE_TIER2.maxRatePct);
  const scBar = bars.find((b) => b.cls === 'special_category')
    ?? { cls: 'special_category' as Tier2Class, leaks: 0, exposures: 0, ratePct: 0, provisional: true, passed: true };
  for (const b of bars) {
    const state = b.provisional
      ? `PROVISIONAL (${b.leaks}/${b.exposures} = ${b.ratePct.toFixed(2)}%, exposures<${GATE_TIER2.minExposures})`
      : b.passed
        ? `${b.ratePct.toFixed(2)}% (${b.leaks}/${b.exposures}) ≤ ${GATE_TIER2.maxRatePct}% ceiling`
        : `FAIL: ${b.ratePct.toFixed(2)}% (${b.leaks}/${b.exposures}) > ${GATE_TIER2.maxRatePct}% ceiling`;
    console.log(`[gate]   TIER-2 ${b.cls.toUpperCase()}${b.cls === 'special_category' ? ' [GATED]' : ' [reported]'}: ${state}`);
  }
  // [TIER2-SPLIT] Per-leak printer — a gate that can't say WHAT leaked can't be acted on. Names every
  // leak: fixture, class, term, the field it landed in (structured store vs free text), and the run.
  for (const r of leakRecords) {
    console.log(`[gate]     leak: fixture="${r.fixtureId}" class=${r.cls} term="${r.term}" field=${r.field} (${r.structured ? 'structured' : 'free-text'}) run=${r.run}`);
  }

  // Rule 7 ISOLATION SIGNAL (non-gating): feed RAW values (no ingest redaction) to measure how
  // often the MODEL itself reproduces a Tier-1 value — the defense-in-depth layer for a pattern
  // redact.ts doesn't recognise. Never gates (prod redacts at ingest first); tracked for drift.
  const redFixtures = EVAL_NOTES.filter((n) => (n.forbidden?.length ?? 0) > 0);
  let r7Leaks = 0;
  let r7Total = 0;
  for (let i = 0; i < RUNS; i++) {
    for (const note of redFixtures) {
      const raw = await extractForEval(model, note, { redactIngest: false, aliases: note.aliases });
      r7Total += 1;
      if (scoreNote(note.expected, raw, note.mustNotMerge, note.forbidden).leakedValues > 0) r7Leaks += 1;
    }
  }
  const r7Pct = r7Total ? (r7Leaks / r7Total) * 100 : 0;
  console.log(`[gate]   RULE-7 ISOLATION (non-gating, defense-in-depth): ${r7Leaks}/${r7Total} raw extractions reproduced a value (${r7Pct.toFixed(2)}%) — prod redacts Tier-1 at ingest; tracked for drift`);

  // [HEALTH-EXCLUSION] Two guarantees, reported apart. STRUCTURED health (a personal_fact tagged
  // `health`) is per-run ZERO — the write-time filter drops it before storage, deterministically, so a
  // survivor is a broken filter (gated). FREE-TEXT health (a health detail the model wrote into a
  // summary/concern, which the filter must NOT edit) stays a stochastic Tier-2 signal — reported, not
  // gated, so removing the health example can be seen to lower it. Baseline before this fix: 5/170 = 2.94%.
  const healthFixtures = EVAL_NOTES.filter((n) => (n.forbidden ?? []).some((f) => /surgery|knee|injury|illness|medic|diagnos|hospital|clinic|treatment|health/i.test(f)));
  let structuredSensitive = 0;
  let freeTextHealthLeaks = 0;
  let healthTotal = 0;
  for (let i = 0; i < RUNS; i++) {
    for (const note of healthFixtures) {
      const ex = await extractForEval(model, note, { aliases: note.aliases }); // shipped pipeline: ingest-redacted + sensitive filter applied
      healthTotal += 1;
      structuredSensitive += structuredSensitiveCount(ex);
      if (scoreNote(note.expected, ex, note.mustNotMerge, note.forbidden).leakedValues > 0) freeTextHealthLeaks += 1;
    }
  }
  const structuredSensitivePass = structuredSensitive === 0;
  const ftPct = healthTotal ? (freeTextHealthLeaks / healthTotal) * 100 : 0;
  console.log(`[gate]   STRUCTURED SENSITIVE (health + special categories): ${structuredSensitivePass ? '0 — per-run zero (deterministic write-time filter drops every sensitive personal_fact)' : `FAIL — ${structuredSensitive} sensitive personal_fact(s) survived the filter`}`);
  console.log(`[gate]   FREE-TEXT HEALTH LEAKAGE (reported, not gated): ${freeTextHealthLeaks}/${healthTotal} = ${ftPct.toFixed(2)}% — baseline before Example K removal: 5/170 = 2.94%`);

  // [SPECIAL-CATEGORY EXPERIMENT v0.9.7] PRIMING probe. Run the special-category fixture(s) with the
  // filter OFF (sensitiveDrop:false) and count how many personal_facts the model TAGGED with a special
  // category. Baseline (v0.9.6, before the labels existed) is 0 by construction. A non-trivial count means
  // adding the labels PRIMED the model to structure these facts more — and per the owner rule, if the
  // labels prime extraction we REVERT (a filter that increases extraction attempts is worse than none,
  // even though it drops them before storage). Reported, never gated — it is an experiment signal.
  const scFixtures = EVAL_NOTES.filter((n) => tier2ClassOf(n.id) === 'special_category');
  const SPECIAL_LABEL = /^(religion|ethnicity|political_opinion|sexual_orientation)$/i;
  let scAttempts = 0;
  let scTotal = 0;
  for (let i = 0; i < RUNS; i++) {
    for (const note of scFixtures) {
      const raw = await extractForEval(model, note, { sensitiveDrop: false, aliases: note.aliases }); // RAW pre-filter output
      scTotal += 1;
      scAttempts += (raw?.personal_facts ?? []).filter((f) => SPECIAL_LABEL.test((typeof f.category === 'string' ? f.category : '').trim())).length;
    }
  }
  console.log(`[gate]   SPECIAL-CATEGORY PRIMING (pre-filter attempts): ${scAttempts} special-category-tagged personal_fact(s) across ${scTotal} extractions — baseline 0 (labels absent before v0.9.7). Non-trivial ⇒ labels primed extraction ⇒ REVERT.`);

  // [GATE-IMPORT-SIZE] Import-sized fixtures — the multi-message regime the single-note set never
  // covered (the blind spot behind the max_tokens + timeout breakages). CI subset runs every gate;
  // the cert-only set (medium/hard) runs with GATE_IMPORT_FULL=1.
  // Gate policy (owner-ruled 2026-09-09, aligned to the certified single-note policy):
  //   - WRONGNESS gates per-run, zero tolerance: guessed-date-on-null, wrong-year date, merged people,
  //     leaked/forbidden entity, retracted/forbidden promise. (Commission errors — asserting a wrong fact.)
  //   - FABRICATION is NOT a per-run import gate — it is the single-note AGGREGATE bar (≤1.2%), exactly
  //     as before. (OMAR-FAB proved per-run fab on a rich fixture just flakes on legitimate variance.)
  //   - RECALL is REPORTED with its baseline beside it (a drift signal), never gated.
  const runImportFull = process.env.GATE_IMPORT_FULL === '1';
  const importFixtures = IMPORT_FIXTURES.filter((f) => f.tier === 'ci-subset' || runImportFull);
  let importPass = true;
  const prevRecall = (id: string): string => { const b = RECALL_BASELINES[id]; return b == null ? 'first cert — no prior' : `prev ${b.toFixed(2)}`; };
  console.log(`\n[gate] === IMPORT-SIZED FIXTURES (${importFixtures.length}: ${importFixtures.map((f) => f.id).join(', ')}${runImportFull ? '' : '; set GATE_IMPORT_FULL=1 for the cert-only set'}) ===`);
  for (const f of importFixtures) {
    const actual = await extractImportFixture(model, f);
    if (actual === null) { console.log(`[gate]   ${f.id}: FAIL — extraction returned nothing (starved/timeout/invalid)`); importPass = false; continue; }
    if (f.mode === 'full') {
      // Full-output (none shipped today): gate on WRONGNESS only — fabrication is the aggregate bar, so
      // fabricatedPromises is NOT a per-run gate here (it flakes on legitimate rewording).
      const s = scoreNote(f.expected, actual, [], f.forbidden);
      const wrongOk = s.guessedDates === 0 && s.leakedValues === 0 && s.mergedPeople === 0 && s.nullNamedPeople === 0;
      importPass &&= wrongOk;
      const expectedFacts = f.expected.promises.length + f.expected.people.length;
      const recall = expectedFacts === 0 ? 1 : (s.promises.tp + s.people.tp) / expectedFacts;
      console.log(`[gate]   ${f.id} [full]: GATE ${wrongOk ? 'PASS' : 'FAIL'} — wrongness{guessed ${s.guessedDates} leak ${s.leakedValues} merged ${s.mergedPeople} nullName ${s.nullNamedPeople}} · RECALL ${recall.toFixed(2)} (${prevRecall(f.id)}) [reported] · fab ${s.fabricatedPromises} (aggregate bar, not gated here)`);
    } else {
      const r = scoreInvariants(f.contract, actual);
      importPass &&= r.wrongness.length === 0; // gate on WRONGNESS; recall + role-misses are reported
      const recall = r.anchorsRequired === 0 ? 1 : r.anchorsFound / r.anchorsRequired;
      const wrongTxt = r.wrongness.length ? ' — WRONGNESS: ' + r.wrongness.join('; ') : '';
      const missTxt = r.recallMisses.length ? ` · reported: ${r.recallMisses.join('; ')}` : '';
      console.log(`[gate]   ${f.id} [invariant]: GATE ${r.wrongness.length === 0 ? 'PASS' : 'FAIL'} · RECALL ${recall.toFixed(2)} (${prevRecall(f.id)}) [reported]${wrongTxt}${missTxt}`);
    }
  }

  const b = budget.report();
  const hitPct = calls > 0 ? (hits / calls) * 100 : 0;
  console.log(`\n[gate] cache: ${hits}/${calls} calls read the warm prefix (${hitPct.toFixed(0)}%) · spend $${b.totalUsd.toFixed(3)} (AED ${b.totalAed.toFixed(2)})`);

  // Deploy gate = the checks meaningful on EVERY push: per-run HARD + soft + Tier-1 zero
  // (all deterministic or cheap). The stochastic aggregate bars (fabrication, Tier-2) only
  // GATE when they have enough sample to certify (non-provisional); below that they are
  // reported, not enforced — a 1/9 Tier-2 spike at 3 runs is noise, not a regression, and
  // gating on it would make CI flaky and teach re-rolling. The aggregates are certified at
  // the periodic large-N run (GATE_RUNS≥30 => FULL CERTIFICATION), not on every push.
  const fabGates = fab.provisional || fab.passed;
  // [TIER2-SPLIT] The privacy gate is the SPECIAL-CATEGORY bar only — an alias-normalisation or 'other'
  // leak never fails it (they're reported, tracked separately). Provisional below the min sample.
  const scGates = scBar.provisional || scBar.passed;
  // REQ-GATE: requirements precision gates like fabrication/Tier-2 — enforced once non-provisional,
  // reported below the floor. Recall is measured, never gated (a missed requirement is invisible;
  // a false one is a wrong pitch in front of a client).
  const reqGate = requirementsGate(agg, modelId);
  const reqGates = reqGate.provisional || reqGate.passed;
  const deployPass = hardPassed && soft.passed && tier1Pass && structuredSensitivePass && fabGates && scGates && reqGates && importPass;
  console.log(`[gate] IMPORT-SIZED: ${importPass ? 'PASS (trust rules held on every import fixture run)' : 'FAIL — an import fixture broke a trust rule or an invariant'}`);
  const fullyCertified = hardPassed && soft.passed && tier1Pass && fab.passed && !fab.provisional && scBar.passed && !scBar.provisional && reqGate.passed && !reqGate.provisional;
  console.log(`\n[gate] DEPLOY GATE: ${deployPass ? 'PASS (per-run hard + soft + Tier-1 zero + structured-sensitive zero + fabrication & special-category ≤ ceiling)' : 'FAIL'}`);
  console.log(`[gate] FULL CERTIFICATION: ${fullyCertified ? 'PASS (aggregate rates certified over ≥ minimum sample)' : deployPass ? 'PROVISIONAL — deploy-safe, an aggregate rate not yet certified at this N' : 'FAIL'}`);
  if (!deployPass) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`[gate] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
