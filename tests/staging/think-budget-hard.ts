/**
 * [THINK-BUDGET] Worst-case point only: the hardest/longest export (5,615 messages) at a high
 * max_tokens, to confirm the ~7k thinking plateau holds at the largest real input before deriving
 * the extraction max_tokens.  npx tsx --env-file=.env tests/staging/think-budget-hard.ts
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { resolveTranscript } from '../../apps/api/src/services/import/resolve.js';
import { parseWhatsAppExport } from '../../apps/api/src/services/import/whatsapp.js';
import { renderThread } from '../../apps/api/src/services/import/dedup.js';
import { USD_TO_AED, PRICING } from '../../apps/api/src/services/metrics/model-budget.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.modelProvider !== 'anthropic') { console.error('need anthropic'); process.exit(1); }
  const r = resolveTranscript(readFileSync('WhatsApp_Chat_with_Bubu_DXB.zip'));
  if (!r.ok) throw new Error(r.reason);
  const p = parseWhatsAppExport(r.text);
  if (!p.ok) throw new Error('parse');
  const userMessage = buildUserMessage({ today: new Date().toISOString().slice(0, 10), clientName: 'Ladder', source: 'whatsapp_export', text: renderThread(p.messages) });
  const t0 = Date.now(); // [EXTRACT-TIMEOUT] wall-clock of the worst real call → derive the HTTP timeout
  const res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicApiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 20000, system: EXTRACTION_SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] }),
  });
  const body = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } }; error?: unknown };
  if (body.error) { console.error('API:', JSON.stringify(body.error)); process.exit(1); }
  const think = body.usage?.output_tokens_details?.thinking_tokens ?? 0;
  const out = body.usage?.output_tokens ?? 0;
  const inTok = body.usage?.input_tokens ?? 0;
  const P = PRICING['claude-sonnet-5']!;
  const usd = (inTok * P.inputPerMTok + out * P.outputPerMTok) / 1e6;
  const elapsedMs = Date.now() - t0;
  console.log(`${p.messages.length} msgs · in ${inTok} · think ${think} · text ${out - think} · out ${out} · stop ${body.stop_reason} · hasText ${(body.content ?? []).some((b) => b.type === 'text' && (b.text?.length ?? 0) > 0)} · $${usd.toFixed(4)} (AED ${(usd * USD_TO_AED).toFixed(3)})`);
  console.log(`WALL-CLOCK: ${elapsedMs}ms (${(elapsedMs / 1000).toFixed(1)}s) — would the 30s prod timeout abort? ${elapsedMs > 30_000 ? 'YES' : 'no'}`);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
