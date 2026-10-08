/**
 * [BLIND-TEST DIAGNOSTIC] Confirm WHY extraction returns empty text. Sends the exact production
 * extraction request (EXTRACTION_SYSTEM_PROMPT + buildUserMessage, max_tokens 2048, claude-sonnet-5)
 * as a RAW Anthropic call and dumps stop_reason, the content-block types, and the full usage — for
 * (a) a tiny single note (gate-fixture sized) and (b) the easy import transcript. If (a) returns text
 * and (b) hits max_tokens with no text block, that is input-size-dependent reasoning exhausting the
 * output budget, and explains why the gate (tiny fixtures) passed while production (imports) fails.
 *
 *   npx tsx --env-file=.env tests/staging/extraction-diagnose.ts
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { resolveTranscript } from '../../apps/api/src/services/import/resolve.js';
import { parseWhatsAppExport } from '../../apps/api/src/services/import/whatsapp.js';
import { renderThread } from '../../apps/api/src/services/import/dedup.js';

const TODAY = new Date().toISOString().slice(0, 10);

async function probe(cfg: ReturnType<typeof loadConfig>, label: string, text: string, source: 'paste' | 'whatsapp_export'): Promise<void> {
  const userMessage = buildUserMessage({ today: TODAY, clientName: 'Diag', source, text });
  const res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicApiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 2048, system: EXTRACTION_SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] }),
  });
  const body = (await res.json()) as {
    stop_reason?: string; model?: string;
    content?: Array<{ type: string; text?: string }>;
    usage?: Record<string, unknown>;
    error?: unknown;
  };
  console.log(`\n===== ${label} (userMessage ~${userMessage.length} chars) =====`);
  if (body.error) { console.log('ERROR:', JSON.stringify(body.error)); return; }
  console.log('model:', body.model, '· stop_reason:', body.stop_reason);
  console.log('content blocks:', (body.content ?? []).map((b) => `${b.type}${typeof b.text === 'string' ? `(text ${b.text.length} chars)` : ''}`).join(', ') || '(none)');
  console.log('usage:', JSON.stringify(body.usage));
  const textBlock = (body.content ?? []).find((b) => b.type === 'text');
  console.log('text block present:', !!textBlock, '· text length:', textBlock?.text?.length ?? 0);
  if (textBlock?.text) console.log('text head:', textBlock.text.slice(0, 200).replace(/\n/g, ' '));
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic + a real key'); process.exit(1); }
  console.log(`model id: ${cfg.anthropicModel} · base: ${cfg.anthropicBaseUrl}`);

  // (a) A tiny single note — the size the P1-9 gate certifies on.
  await probe(cfg, 'TINY single note (gate-sized)', "Client said he'll send the signed SPA by Thursday and wants a 2-bed near the marina under 1.4M.", 'paste');

  // (b) A real import transcript — supply a LOCAL export path (never committed; chat exports are ignored).
  const zipPath = process.env.STAGING_ZIP ?? process.argv[2];
  if (!zipPath) { console.error('set STAGING_ZIP=<path/to/export.zip> (or pass as argv[2]) to run the import probe'); return; }
  const resolved = resolveTranscript(readFileSync(zipPath));
  if (!resolved.ok) { console.error('resolve failed:', resolved.reason); return; }
  const parsed = parseWhatsAppExport(resolved.text);
  if (!parsed.ok) { console.error('parse failed'); return; }
  await probe(cfg, 'EASY import (68 messages)', renderThread(parsed.messages), 'whatsapp_export');
}

main().catch((e) => { console.error('DIAG FAILED:', e); process.exit(1); });
