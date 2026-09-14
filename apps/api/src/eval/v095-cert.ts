/**
 * [RECEIPTS-v0.9.5 CERTIFICATION HARNESS] Runs the v0.9.5 CANDIDATE prompt against the certified
 * EVAL_NOTES (base-fact regression) and the v0.9.5 DRAFT fixtures (the new source_span / source_message_at
 * metrics), and — for the base facts — reuses the SAME scoring + gates as the production gate. It does
 * NOT modify prompt.ts, eval-set.ts, or the gate; it reads the raw model JSON directly so it can score
 * source_span (which asExtraction drops).
 *
 * Env:
 *   PROMPT=v095|v094   which system prompt (default v095)
 *   GATE_RUNS=N        repeats over EVAL_NOTES (default 3; a fabrication CERT needs N*43 >= 960, i.e. 23)
 *   DRAFT_RUNS=N       repeats over the 10 draft fixtures for span/time accuracy (default 3)
 *   SPAN_ONLY=1        skip EVAL_NOTES, run only the draft fixtures (cheap check)
 *
 * source_span rule (gate policy): a non-null source_span that does NOT appear verbatim in the source
 * note is a FABRICATED span — held to the same zero-tolerance as a fabricated date. source_message_at
 * must be null for sources with no per-message timestamp (voice/paste/ask); a timestamp there is a
 * fabricated one.
 */
import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { buildUserMessage, EXTRACTION_MAX_TOKENS, EXTRACTION_SYSTEM_PROMPT } from '../services/extraction/prompt.js';
import { EXTRACTION_SYSTEM_PROMPT_V095 } from '../services/extraction/prompt-v0.9.5-draft.js';
import { EVAL_NOTES } from './eval-set.js';
import { V095_DRAFT_FIXTURES } from './eval-set-v0.9.5-DRAFT.js';
import { scoreNote, aggregate } from './score.js';
import { evaluateGate, softGate, fabricationGate, GATE_FAB } from './gate.js';
import { asExtraction } from '../services/extraction/validate.js';
import { extractJsonObject } from '../services/extraction/parse.js';
import { redactSensitive } from '../services/redaction/redact.js';
import type { ModelClient } from '../ports/model.js';

const p2 = (n: number): string => n.toFixed(2);
const RECEIPT_TYPES = ['promises', 'people', 'personal_facts', 'key_dates'] as const;

/** Normalise for a verbatim-containment check: unify quotes/whitespace, lowercase. A span "appears in"
 *  the note if, after this, the note contains it. Conservative — punctuation/quote variants don't count
 *  as fabrication, but genuinely invented text does. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, ' ').trim();
}
function spanInNote(span: string, note: string): boolean {
  return norm(note).includes(norm(span));
}

interface SpanTally { emitted: number; verbatim: number; fabricated: number; nonNullTime: number; }
function tallySpans(raw: unknown, noteText: string, into: SpanTally): void {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const items: Array<Record<string, unknown>> = [];
  for (const t of RECEIPT_TYPES) if (Array.isArray(obj[t])) items.push(...(obj[t] as Record<string, unknown>[]));
  const m = obj.meeting as Record<string, unknown> | null | undefined;
  if (m && typeof m === 'object') items.push(m);
  for (const it of items) {
    const span = it.source_span;
    if (typeof span === 'string' && span.trim()) {
      into.emitted += 1;
      if (spanInNote(span, noteText)) into.verbatim += 1; else into.fabricated += 1;
    }
    if (it.source_message_at != null && String(it.source_message_at).trim()) into.nonNullTime += 1;
  }
}

/** Record the exact fabricated spans (non-null, not verbatim in the note) for eyes-on diagnosis. */
function collectFabSpans(raw: unknown, noteText: string, noteId: string, into: string[]): void {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const items: Array<Record<string, unknown>> = [];
  for (const t of RECEIPT_TYPES) if (Array.isArray(obj[t])) items.push(...(obj[t] as Record<string, unknown>[]));
  const m = obj.meeting as Record<string, unknown> | null | undefined;
  if (m && typeof m === 'object') items.push(m);
  for (const it of items) {
    const span = it.source_span;
    if (typeof span === 'string' && span.trim() && !spanInNote(span, noteText)) into.push(`[${noteId}] "${span}"`);
  }
}

async function extract(model: ModelClient, system: string, note: { today: string; clientName: string; source: string; text: string }): Promise<{ raw: unknown; text: string }> {
  const req = {
    system, cacheSystemPrompt: true, cacheTtl: '1h' as const, maxTokens: EXTRACTION_MAX_TOKENS,
    messages: [{ role: 'user' as const, content: buildUserMessage({ today: note.today, clientName: note.clientName, source: note.source as never, text: note.text }) }],
  };
  // Retry transient network blips (ETIMEDOUT / fetch failed) so one hiccup doesn't kill a long run.
  // A genuine extraction failure after retries returns empty (scored as a miss), never a crash.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await model.complete(req);
      return { raw: extractJsonObject(res.text), text: res.text };
    } catch (e) {
      if (attempt === 4) { console.error(`[v095-cert] extract failed after ${attempt} attempts: ${e instanceof Error ? e.message : String(e)}`); return { raw: null, text: '' }; }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { raw: null, text: '' };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const modelId = config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
  const system = (process.env.PROMPT ?? 'v095') === 'v094' ? EXTRACTION_SYSTEM_PROMPT : EXTRACTION_SYSTEM_PROMPT_V095;
  const promptLabel = (process.env.PROMPT ?? 'v095');
  const GATE_RUNS = Math.max(1, Number(process.env.GATE_RUNS ?? 3));
  const DRAFT_RUNS = Math.max(1, Number(process.env.DRAFT_RUNS ?? 3));
  const spanOnly = process.env.SPAN_ONLY === '1';

  let calls = 0, cacheHits = 0;
  const model: ModelClient = { complete: async (req) => { const r = await createModelClient(config).complete(req); calls++; if ((r.usage?.cacheReadInputTokens ?? 0) > 0) cacheHits++; return r; } };

  console.log(`[v095-cert] model=${modelId} prompt=${promptLabel} GATE_RUNS=${GATE_RUNS} DRAFT_RUNS=${DRAFT_RUNS} spanOnly=${spanOnly}`);

  // ---- Part A: base-fact regression + span-fabrication over the certified EVAL_NOTES ----
  const diagGuessed = new Map<string, number>();
  const diagFab = new Map<string, number>();
  const diagSpan: string[] = [];
  if (!spanOnly) {
    const allScores = [];
    const spanEval: SpanTally = { emitted: 0, verbatim: 0, fabricated: 0, nonNullTime: 0 };
    let hardPassed = true;
    for (let run = 1; run <= GATE_RUNS; run++) {
      const scored = [];
      for (const note of EVAL_NOTES) {
        const redacted = redactSensitive(note.note).redacted; // mirror prod/gate ingest redaction
        const { raw } = await extract(model, system, { today: note.today, clientName: note.clientName, source: note.source, text: redacted });
        let base = null; try { base = raw ? asExtraction(raw) : null; } catch { base = null; }
        // Apply the production DATE-INVARIANT exactly as extractForEval/extractNote does: a promise
        // cannot be due before the note's reference date — null it + confidence low. The gate scores
        // the FULL pipeline, not the raw prompt output.
        if (base) for (const pr of base.promises) if (pr.due_date !== null && pr.due_date < note.today) { pr.due_date = null; pr.confidence = 'low'; }
        const sc = scoreNote(note.expected, base, note.mustNotMerge, note.forbidden);
        scored.push(sc);
        if (sc.guessedDates > 0) diagGuessed.set(note.id, (diagGuessed.get(note.id) ?? 0) + sc.guessedDates);
        if (sc.fabricatedPromises > 0) diagFab.set(note.id, (diagFab.get(note.id) ?? 0) + sc.fabricatedPromises);
        // span-fabrication on the same extractions, collecting the offending spans for eyes-on
        const before = spanEval.fabricated;
        tallySpans(raw, redacted, spanEval);
        if (spanEval.fabricated > before) collectFabSpans(raw, redacted, note.id, diagSpan);
      }
      const agg = aggregate(scored);
      const g = evaluateGate(agg, modelId);
      hardPassed &&= g.passed;
      console.log(`[v095-cert] EVAL run ${run}: promises p=${p2(agg.promises.precision)} r=${p2(agg.promises.recall)} · people p=${p2(agg.people.precision)} r=${p2(agg.people.recall)} · guessed=${agg.guessedDates} merged=${agg.mergedPeople} nullNamed=${agg.nullNamedPeople} fab=${agg.fabricatedPromises} → ${g.passed ? 'HARD PASS' : 'HARD FAIL: ' + g.reasons.join('; ')}`);
      allScores.push(...scored);
    }
    const agg = aggregate(allScores);
    const soft = softGate(agg, modelId);
    const fab = fabricationGate(agg, modelId);
    console.log(`\n[v095-cert] === EVAL AGGREGATE (${GATE_RUNS} runs, ${allScores.length} extractions) ===`);
    console.log(`[v095-cert] soft: promises r=${p2(agg.promises.recall)} people p=${p2(agg.people.precision)} r=${p2(agg.people.recall)} → ${soft.passed ? 'PASS' : 'FAIL: ' + soft.reasons.join('; ')}`);
    console.log(`[v095-cert] HARD (per-run zero-tolerance): guessedDates=${agg.guessedDates} mergedPeople=${agg.mergedPeople} nullNamed=${agg.nullNamedPeople} → ${hardPassed ? 'PASS (every run)' : 'FAIL'}`);
    console.log(`[v095-cert] fabricated PROMISES: ${agg.fabricatedPromises}/${fab.extractions} = ${fab.ratePct.toFixed(2)}% (bar ${GATE_FAB.maxRatePct}%, standard ${GATE_FAB.certifiedRatePct}%) → ${fab.provisional ? `PROVISIONAL (N<${GATE_FAB.minExtractions})` : fab.passed ? 'PASS' : 'FAIL'}`);
    const spanFabPct = spanEval.emitted ? (spanEval.fabricated / spanEval.emitted) * 100 : 0;
    console.log(`[v095-cert] source_span on EVAL: emitted=${spanEval.emitted} verbatim=${spanEval.verbatim} FABRICATED=${spanEval.fabricated} (${spanFabPct.toFixed(2)}%) → ${spanEval.fabricated === 0 ? 'PASS (0 fabricated spans)' : 'FAIL — a fabricated span is as serious as a fabricated date'}`);
    // Eyes-on diagnostics — WHICH notes/spans, so a "fail" can be judged real vs measurement artifact.
    if (diagGuessed.size) console.log(`[v095-cert] DIAG guessed-date notes: ${[...diagGuessed.entries()].map(([id, n]) => `${id}×${n}`).join(', ')}`);
    if (diagFab.size) console.log(`[v095-cert] DIAG fabricated-promise notes: ${[...diagFab.entries()].map(([id, n]) => `${id}×${n}`).join(', ')}`);
    if (diagSpan.length) console.log(`[v095-cert] DIAG fabricated spans:\n${diagSpan.slice(0, 20).map((s) => '   ' + s).join('\n')}`);
  }

  // ---- Part B: source_span + source_message_at ACCURACY on the draft fixtures (expected values) ----
  console.log(`\n[v095-cert] === DRAFT FIXTURES (${DRAFT_RUNS} runs × ${V095_DRAFT_FIXTURES.length}) — source_span / source_message_at accuracy ===`);
  let spanVerbatim = 0, spanEmitted = 0, spanFab = 0, timeCorrect = 0, timeChecked = 0, timeBadNull = 0;
  for (let run = 1; run <= DRAFT_RUNS; run++) {
    for (const fx of V095_DRAFT_FIXTURES) {
      const { raw } = await extract(model, system, { today: fx.today, clientName: fx.clientName, source: fx.source, text: fx.note });
      const obj = (raw ?? {}) as Record<string, unknown>;
      const bucket = fx.factType === 'promise' ? 'promises' : fx.factType === 'person' ? 'people' : fx.factType === 'personal_fact' ? 'personal_facts' : fx.factType === 'key_date' ? 'key_dates' : 'meeting';
      const arr = bucket === 'meeting' ? (obj.meeting ? [obj.meeting] : []) : (Array.isArray(obj[bucket]) ? obj[bucket] as Record<string, unknown>[] : []);
      const first = arr[0] as Record<string, unknown> | undefined;
      const span = first?.source_span;
      if (typeof span === 'string' && span.trim()) { spanEmitted++; if (spanInNote(span, fx.note)) spanVerbatim++; else spanFab++; }
      // source_message_at: expected null for ambiguous; a real ts (present in the note) for clean.
      const at = first?.source_message_at;
      timeChecked++;
      if (fx.kind === 'ambiguous') { if (at == null) timeCorrect++; else timeBadNull++; }
      else { if (at != null && fx.note.includes(String(at))) timeCorrect++; }
    }
  }
  const spanAcc = spanEmitted ? (spanVerbatim / spanEmitted) * 100 : 0;
  console.log(`[v095-cert] draft source_span: emitted=${spanEmitted} verbatim=${spanVerbatim} (${spanAcc.toFixed(1)}%) FABRICATED=${spanFab} → ${spanFab === 0 ? 'PASS (0 fabricated)' : 'FAIL'}`);
  console.log(`[v095-cert] draft source_message_at: correct=${timeCorrect}/${timeChecked} · ambiguous-cases-wrongly-timestamped=${timeBadNull} → ${timeBadNull === 0 ? 'PASS (no false timestamps on ambiguous)' : 'FAIL'}`);
  console.log(`\n[v095-cert] calls=${calls} cacheHits=${cacheHits}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
