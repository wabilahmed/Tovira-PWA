/**
 * IMPORT-COST measurement (test(COST-MEASURE)). Establishes the REAL per-import cost by
 * reusing the existing bake-off ladder (51/301/1501/5001/10001 lines) — WITHOUT re-running
 * the already-measured extraction. It uses Anthropic's free `count_tokens` endpoint to get
 * the exact input-token count of the one extraction call an import makes, then applies the
 * committed PRICING table (validated against CACHE-REPORT: warm $0.005 / cold $0.045 per
 * daily note). Zero generation is billed; count_tokens does not charge for tokens.
 *
 * Why this is the right measurement: an import is provably ONE Claude call over the whole
 * transcript (notes-routes → one note → one extract; no chunking). Its cost is dominated by
 * the transcript as UNCACHED variable input — the cached prefix is a fixed ~7k tokens. So the
 * only unknown is transcript token count per export; count_tokens gives it exactly.
 *
 *   npx tsx --env-file=.env tests/staging/import-cost-measure.ts
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { PRICING, USD_TO_AED } from '../../apps/api/src/services/metrics/model-budget.js';
import { EXPORTS } from './lib/bakeoff-exports.js';
import { generateExport } from './lib/planting.js';

const MODEL = 'claude-sonnet-5'; // the locked extraction model (routing guard)
const MAX_OUTPUT = 2048; // extraction call's maxTokens — the upper bound on output billed
const TITAN_USD_PER_MTOK = 0.02; // Amazon Titan Text Embeddings V2 list price (NOT in codebase — see report)
const TITAN_MAX_INPUT_TOKENS = 8192; // Titan V2 input cap; a huge transcript embed is truncated to this

interface CountResp { input_tokens: number }

async function countTokens(cfg: ReturnType<typeof loadConfig>, system: string, userText: string): Promise<number> {
  const res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.anthropicApiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, system, messages: [{ role: 'user', content: userText }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  return ((await res.json()) as CountResp).input_tokens;
}

const p = PRICING[MODEL]!;
const aed = (usd: number): number => usd * USD_TO_AED;

/** Warm import: prefix served from cache (read), transcript billed at full input rate, output at output rate. */
function warmUsd(prefixTok: number, transcriptTok: number, outputTok: number): number {
  return (prefixTok * p.cacheReadPerMTok + transcriptTok * p.inputPerMTok + outputTok * p.outputPerMTok) / 1e6;
}
/** Cold import (prefix cache miss → write). The delta vs warm is only on the fixed prefix. */
function coldUsd(prefixTok: number, transcriptTok: number, outputTok: number): number {
  return (prefixTok * p.cacheWritePerMTok + transcriptTok * p.inputPerMTok + outputTok * p.outputPerMTok) / 1e6;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic + a real key in .env'); process.exit(1); }

  // Print the estimate first (the ModelBudget discipline). count_tokens is unbilled, so the
  // estimate is $0.00 of generation; we state it explicitly rather than pretend there's a budget.
  console.log(`ESTIMATE: $0.00 generation (count_tokens is free). ${EXPORTS.length} exports × 2 count calls each.`);

  // The cached prefix, measured once. A 1-char probe (the API rejects empty content); the single
  // token it adds is subtracted out below, so transcript tokens are isolated cleanly.
  const prefixTok = await countTokens(cfg, EXTRACTION_SYSTEM_PROMPT, '.');
  console.log(`Prefix (cached) tokens: ${prefixTok}`);

  interface Row { id: string; lines: number; messages: number; chars: number; transcriptTok: number; warm: number; cold: number; }
  const rows: Row[] = [];

  for (const spec of EXPORTS) {
    const { text } = generateExport(spec);
    const lines = text.split('\n').length;
    const messages = text.split('\n').filter((l) => /^\[/.test(l)).length; // WhatsApp lines start with [timestamp]
    // The exact user message the extraction call sends (today/clientName scaffold + transcript).
    const userMessage = buildUserMessage({ today: spec.today, clientName: 'BakeoffCo', source: 'paste', text });
    const totalIn = await countTokens(cfg, EXTRACTION_SYSTEM_PROMPT, userMessage);
    const transcriptTok = Math.max(0, totalIn - prefixTok);
    const warm = warmUsd(prefixTok, transcriptTok, MAX_OUTPUT);
    const cold = coldUsd(prefixTok, transcriptTok, MAX_OUTPUT);
    rows.push({ id: spec.id, lines, messages, chars: text.length, transcriptTok, warm, cold });
    console.log(`${spec.id}: ${messages} msgs / ${lines} lines / ${text.length} chars → transcript ${transcriptTok} tok · warm $${warm.toFixed(4)} (AED ${aed(warm).toFixed(3)}) · cold $${cold.toFixed(4)}`);
  }

  // Embedding cost per import: 1 note embed (capped at Titan's 8192-token input) + N requirement
  // embeds (tiny). Bounded and negligible; stated from the Titan list price, not billed here.
  const noteEmbedUsd = (TITAN_MAX_INPUT_TOKENS * TITAN_USD_PER_MTOK) / 1e6;

  // Distribution (min / median / max) on the WARM figure — the realistic case.
  const warmSorted = [...rows].sort((a, b) => a.warm - b.warm);
  const median = warmSorted[Math.floor(warmSorted.length / 2)]!;

  const lines: string[] = [];
  lines.push('## Measured per-import extraction cost (warm, upper-bound output=2048)\n');
  lines.push('| export | messages | lines | transcript tokens | warm USD | warm AED | cold USD | cold AED | Δ cold−warm |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.messages} | ${r.lines} | ${r.transcriptTok} | $${r.warm.toFixed(4)} | ${aed(r.warm).toFixed(3)} | $${r.cold.toFixed(4)} | ${aed(r.cold).toFixed(3)} | ${(((r.cold - r.warm) / r.warm) * 100).toFixed(0)}% |`);
  }
  lines.push('');
  lines.push(`Prefix (cached) tokens: **${prefixTok}**. Distribution (warm AED): min **${aed(warmSorted[0]!.warm).toFixed(3)}** (${warmSorted[0]!.id}), median **${aed(median.warm).toFixed(3)}** (${median.id}), max **${aed(warmSorted[warmSorted.length - 1]!.warm).toFixed(3)}** (${warmSorted[warmSorted.length - 1]!.id}).`);
  lines.push('');
  // Per-line and per-1000-messages, taken off the largest export (least scaffold noise).
  const big = rows[rows.length - 1]!;
  lines.push(`Per-line (from ${big.id}): $${(big.warm / big.lines).toFixed(6)} (AED ${aed(big.warm / big.lines).toFixed(6)}). Per 1,000 messages: AED **${aed((big.warm / big.messages) * 1000).toFixed(3)}**.`);
  lines.push(`Embedding cost/import: ≤ $${noteEmbedUsd.toFixed(5)} note embed (Titan V2, capped at ${TITAN_MAX_INPUT_TOKENS} tok) + N×~$0.0000006 per requirement → **negligible (≤ AED ${aed(noteEmbedUsd + 100 * 30 * TITAN_USD_PER_MTOK / 1e6).toFixed(4)} even at 100 requirements)**.`);

  const out = '## import-cost-measure.ts output\n\n' + lines.join('\n') + '\n';
  writeFileSync('tests/staging/IMPORT-COST-MEASURE.out.md', out);
  console.log('\nwrote tests/staging/IMPORT-COST-MEASURE.out.md');
}

main().catch((e) => { console.error(e); process.exit(1); });
