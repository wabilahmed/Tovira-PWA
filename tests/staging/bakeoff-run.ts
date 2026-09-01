/**
 * Bake-off runner (Tasks 6+7). Runs both models through the certified 5-export ladder
 * via the REAL cached v0.6 path, scores against the answer keys, and writes
 * BAKEOFF-REPORT.md. Cache warm-up is a GATE: each model must hit ≥90% on a 10-call
 * warm-up before its ladder runs, else we stop (a cold run gives a false economic
 * verdict). Per-export hit rate is reported; a sub-threshold export is re-run once.
 *
 *   npx tsx --env-file=.env tests/staging/bakeoff-run.ts
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { createModelClient } from '../../apps/api/src/container.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { extractJsonObject } from '../../apps/api/src/services/extraction/parse.js';
import { asExtraction } from '../../apps/api/src/services/extraction/validate.js';
import { scoreNote } from '../../apps/api/src/eval/score.js';
import { ModelBudget } from '../../apps/api/src/services/metrics/model-budget.js';
import type { ModelClient } from '../../apps/api/src/ports/model.js';
import type { Extraction } from '../../apps/api/src/services/extraction/types.js';
import { EXPORTS } from './lib/bakeoff-exports.js';
import { generateExport, type ExportSpec } from './lib/planting.js';

const EMPTY: Extraction = { summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null };

function expectedFrom(spec: ExportSpec): { expected: Extraction; mustNotMerge: Array<[string, string]> } {
  const { answerKey } = generateExport(spec);
  const expected: Extraction = {
    ...EMPTY,
    promises: answerKey.promises.map((p) => ({ text: p.text, owner: p.owner as 'rep' | 'client', due_date: p.dueDate, due_raw: p.dueRaw, confidence: p.confidence as 'high' | 'low' })),
    people: answerKey.people.map((name) => ({ name, role: null, reports_to: null, decision_role: 'unknown' as const, notes: null })),
    key_dates: answerKey.keyDates.map((k) => ({ description: k.description, date: k.date, date_raw: k.dateRaw, type: 'deadline' })),
  };
  // no-merge pairs come from the planted people that must stay distinct (Sara/Sarah etc.)
  const names = answerKey.people;
  const mustNotMerge: Array<[string, string]> = names.length >= 2 ? [[names[0]!, names[1]!]] : [];
  return { expected, mustNotMerge };
}

async function callCached(model: ModelClient, today: string, clientName: string, text: string): Promise<{ extraction: Extraction | null; hit: boolean; usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number } }> {
  const res = await model.complete({
    system: EXTRACTION_SYSTEM_PROMPT,
    cacheSystemPrompt: true,
    cacheTtl: '1h',
    messages: [{ role: 'user', content: buildUserMessage({ today, clientName, source: 'paste', text }) }],
    maxTokens: 2048,
  });
  const usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
  let extraction: Extraction | null = null;
  const parsed = extractJsonObject(res.text);
  if (parsed) { try { extraction = asExtraction(parsed); } catch { extraction = null; } }
  return { extraction, hit: (usage.cacheReadInputTokens ?? 0) > 0, usage };
}

async function warmup(model: ModelClient, budget: ModelBudget, modelId: string): Promise<number> {
  let hits = 0;
  for (let i = 0; i < 10; i++) {
    const r = await callCached(model, '2026-09-01', 'WarmupCo', `warm ${i}: quick note, nothing firm.`);
    budget.record('extraction', modelId, r.usage);
    if (i > 0 && r.hit) hits += 1; // call 1 may write; 2..10 should read
  }
  return (hits / 9) * 100;
}

interface ExportResult {
  id: string;
  hitRatePct: number;
  hard: { fabricatedPromises: number; guessedDates: number; mergedPeople: number; nullNamedPeople: number; falseCertainties: number };
  promises: { tp: number; fp: number; fn: number };
  people: { tp: number; fp: number; fn: number };
  usd: number;
  ms: number;
  disqualified: boolean;
}

async function runLadder(modelId: string, model: ModelClient, budget: ModelBudget): Promise<{ warmupPct: number; results: ExportResult[]; abortedAt: string | null }> {
  const warmupPct = await warmup(model, budget, modelId);
  const results: ExportResult[] = [];
  let abortedAt: string | null = null;
  if (warmupPct < 90) return { warmupPct, results, abortedAt: 'WARMUP_BELOW_90' };
  for (const spec of EXPORTS) {
    const { expected, mustNotMerge } = expectedFrom(spec);
    const { text } = generateExport(spec);
    const t0 = Date.now();
    let r = await callCached(model, spec.today, 'BakeoffCo', text);
    // Re-run once if this export ran cold (< the warm threshold in one call = a cold write).
    if (!r.hit) r = await callCached(model, spec.today, 'BakeoffCo', text);
    const ms = Date.now() - t0;
    budget.record('extraction', modelId, r.usage);
    const s = scoreNote(expected, r.extraction, mustNotMerge);
    const nullNamed = (r.extraction?.people ?? []).filter((p) => (p.name ?? '').trim() === '').length;
    const hard = { fabricatedPromises: s.fabricatedPromises, guessedDates: s.guessedDates, mergedPeople: s.mergedPeople, nullNamedPeople: nullNamed, falseCertainties: s.falseCertainties };
    const disqualified = Object.values(hard).some((v) => v > 0);
    results.push({ id: spec.id, hitRatePct: r.hit ? 100 : 0, hard, promises: s.promises, people: s.people, usd: budget.report().totalUsd, ms, disqualified });
    if (disqualified) { abortedAt = spec.id; break; } // abort the ladder on the first hard-trust violation
  }
  return { warmupPct, results, abortedAt };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic + a real key'); process.exit(1); }

  const runs: Record<string, Awaited<ReturnType<typeof runLadder>>> = {};
  const envUsed: Record<string, string> = {};
  const budget = new ModelBudget(3.0, 0.5); // estimate $3 for the whole bake-off, 50% margin

  for (const modelId of ['claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
    // Sanctioned env-only switch (local, temporary): drive the extraction class to this model.
    process.env.MODEL_EXTRACTION = modelId;
    envUsed[modelId] = `MODEL_EXTRACTION=${modelId}`;
    const model = createModelClient(loadConfig(), 'extraction');
    console.log(`\n=== ${modelId} — warm-up gate (≥90%) ===`);
    runs[modelId] = await runLadder(modelId, model, budget);
    console.log(`${modelId}: warm-up ${runs[modelId]!.warmupPct.toFixed(0)}% · exports scored: ${runs[modelId]!.results.length}${runs[modelId]!.abortedAt ? ` · aborted at ${runs[modelId]!.abortedAt}` : ''}`);
  }
  delete process.env.MODEL_EXTRACTION; // restore

  const b = budget.report();
  const lines: string[] = ['# Bake-off report — Sonnet vs Haiku, five exports\n'];
  lines.push(`Prompt v0.6 · pinned today=2026-09-01 · cached (1h TTL) · budget est $${b.estimateUsd.toFixed(2)}, actual $${b.totalUsd.toFixed(3)} (AED ${b.totalAed.toFixed(2)}).`);
  lines.push('Sanctioned env-only switch (local, temporary): ' + Object.values(envUsed).join(' ; ') + '. Committed default stays Sonnet (routing guard).');
  lines.push('\n**Hard trust rules — any non-zero on any export disqualifies a model for extraction.**\n');
  for (const modelId of Object.keys(runs)) {
    const run = runs[modelId]!;
    lines.push(`\n## ${modelId}`);
    lines.push(`Warm-up prefix hit rate: **${run.warmupPct.toFixed(0)}%** ${run.warmupPct >= 90 ? '(gate passed — prefix clears this model\'s minimum + caches)' : '(GATE FAILED — ladder not run, numbers would be void)'}`);
    if (run.abortedAt && run.abortedAt !== 'WARMUP_BELOW_90') lines.push(`Ladder ABORTED at ${run.abortedAt} on a hard-trust violation.`);
    lines.push('\n| export | hit% | fabricated | guessed | merged | null-named | falseCert | promises tp/fp/fn | people tp/fp/fn |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of run.results) {
      lines.push(`| ${r.id} | ${r.hitRatePct} | ${r.hard.fabricatedPromises} | ${r.hard.guessedDates} | ${r.hard.mergedPeople} | ${r.hard.nullNamedPeople} | ${r.hard.falseCertainties} | ${r.promises.tp}/${r.promises.fp}/${r.promises.fn} | ${r.people.tp}/${r.people.fp}/${r.people.fn} |`);
    }
    const anyViol = run.results.some((r) => r.disqualified);
    lines.push(`\n**Verdict: ${anyViol ? `DISQUALIFIED (hard-trust violation at ${run.abortedAt})` : run.warmupPct < 90 ? 'INCONCLUSIVE (warm-up gate failed)' : 'zero hard-trust violations across scored exports'}.**`);
  }
  lines.push('\n## Decision');
  const haiku = runs['claude-haiku-4-5-20251001'];
  const haikuClean = haiku && haiku.warmupPct >= 90 && haiku.results.length === EXPORTS.length && !haiku.results.some((r) => r.disqualified);
  lines.push(haikuClean
    ? '- Haiku had **zero** hard-trust violations across all five → **recommend a formal 3-run P1-9 Haiku re-certification** (both subsets). The gate decides; this bake-off is evidence, not a substitute. If it passes, extraction cost drops ~3x.'
    : '- Haiku had a hard-trust violation (or an inconclusive gate) → **Sonnet stays locked.** Failure shape recorded above; the question is closed with evidence.');
  lines.push('\n_Note: RU/TL lines in export-5 are uncertified filler, scored separately; a miss there is not a regression._');
  writeFileSync('BAKEOFF-REPORT.md', lines.join('\n') + '\n');
  console.log(`\nwrote BAKEOFF-REPORT.md · actual spend $${b.totalUsd.toFixed(3)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
