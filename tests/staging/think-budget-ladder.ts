/**
 * [THINK-BUDGET] Measure the reasoning budget of the extraction call across an input-size ladder,
 * so max_tokens is DERIVED, not guessed. Sends the exact production request (EXTRACTION_SYSTEM_PROMPT
 * + buildUserMessage, claude-sonnet-5) at a HIGH max_tokens (so thinking is never truncated) and
 * records stop_reason + input_tokens + output split into thinking vs text, per size.
 *
 *   npx tsx --env-file=.env tests/staging/think-budget-ladder.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { resolveTranscript } from '../../apps/api/src/services/import/resolve.js';
import { parseWhatsAppExport, type ParsedMessage } from '../../apps/api/src/services/import/whatsapp.js';
import { renderThread } from '../../apps/api/src/services/import/dedup.js';
import { USD_TO_AED, PRICING } from '../../apps/api/src/services/metrics/model-budget.js';

const TODAY = new Date().toISOString().slice(0, 10);
const HIGH_MAX = 20000; // well above any plausible thinking budget → never truncate the measurement
const P = PRICING['claude-sonnet-5']!;

function messagesFrom(zip: string): ParsedMessage[] {
  const r = resolveTranscript(readFileSync(zip));
  if (!r.ok) throw new Error(`resolve ${zip}: ${r.reason}`);
  const p = parseWhatsAppExport(r.text);
  if (!p.ok) throw new Error(`parse ${zip}`);
  return p.messages;
}

async function measure(cfg: ReturnType<typeof loadConfig>, msgs: ParsedMessage[]): Promise<{ inTok: number; outTok: number; think: number; textTok: number; stop: string; hasText: boolean }> {
  const text = renderThread(msgs);
  const userMessage = buildUserMessage({ today: TODAY, clientName: 'Ladder', source: 'whatsapp_export', text });
  const res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicApiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: HIGH_MAX, system: EXTRACTION_SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] }),
  });
  const body = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } }; error?: unknown };
  if (body.error) throw new Error(`API: ${JSON.stringify(body.error)}`);
  const think = body.usage?.output_tokens_details?.thinking_tokens ?? 0;
  const outTok = body.usage?.output_tokens ?? 0;
  const hasText = (body.content ?? []).some((b) => b.type === 'text' && (b.text?.length ?? 0) > 0);
  return { inTok: body.usage?.input_tokens ?? 0, outTok, think, textTok: outTok - think, stop: body.stop_reason ?? '?', hasText };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic + a real key'); process.exit(1); }
  const easy = messagesFrom('WhatsApp_Chat_with_Omar_Al_Mansouri.zip');
  const medium = messagesFrom('WhatsApp_Chat_with_Farah_Insurance.zip');
  const hard = messagesFrom('WhatsApp_Chat_with_Bubu_DXB.zip');

  const ladder = [
    { n: 1, msgs: easy.slice(0, 1) },
    { n: 10, msgs: easy.slice(0, 10) },
    { n: easy.length, msgs: easy },
    { n: medium.length, msgs: medium },
    { n: 1500, msgs: hard.slice(0, 1500) },
    { n: hard.length, msgs: hard },
  ];

  console.log(`max_tokens=${HIGH_MAX} (no truncation). model=${cfg.anthropicModel}`);
  const rows: Array<{ n: number; inTok: number; think: number; textTok: number; stop: string; hasText: boolean; usd: number }> = [];
  for (const { n, msgs } of ladder) {
    const m = await measure(cfg, msgs);
    // Cost with a WARM prefix (cache read) — variable input billed at input rate, output (incl thinking) at output rate.
    const usd = (m.inTok * P.inputPerMTok + m.outTok * P.outputPerMTok) / 1e6;
    rows.push({ n, inTok: m.inTok, think: m.think, textTok: m.textTok, stop: m.stop, hasText: m.hasText, usd });
    console.log(`${String(n).padStart(5)} msgs · in ${m.inTok} · think ${m.think} · text ${m.textTok} · stop ${m.stop} · hasText ${m.hasText} · $${usd.toFixed(4)}`);
  }

  const lines = ['# Thinking-budget ladder (THINK-BUDGET)\n', `model ${cfg.anthropicModel} · max_tokens ${HIGH_MAX} (no truncation) · ${new Date().toISOString()}\n`];
  lines.push('| messages | input tokens | thinking tokens | text tokens | stop_reason | has text | $ (raw, uncached prefix) |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.n} | ${r.inTok} | ${r.think} | ${r.textTok} | ${r.stop} | ${r.hasText} | $${r.usd.toFixed(4)} (AED ${(r.usd * USD_TO_AED).toFixed(3)}) |`);
  const maxThink = Math.max(...rows.map((r) => r.think));
  const maxText = Math.max(...rows.map((r) => r.textTok));
  lines.push(`\nPeak thinking tokens: **${maxThink}** · peak text tokens: **${maxText}**.`);
  writeFileSync('tests/staging/THINK-BUDGET-LADDER.out.md', lines.join('\n') + '\n');
  console.log(`\nwrote tests/staging/THINK-BUDGET-LADDER.out.md · peak thinking ${maxThink}, peak text ${maxText}`);
}

main().catch((e) => { console.error('LADDER FAILED:', e); process.exit(1); });
