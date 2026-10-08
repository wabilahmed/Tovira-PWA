/**
 * [BLIND-TEST] Import three real zipped WhatsApp exports through the REAL import path (unzip →
 * content-select transcript → parse → confirm-gate → store → extraction on real Sonnet) and dump
 * everything for comparison against an answer key we do not have. No tuning, no retries. Faithful
 * report of whatever comes back — good or bad.
 *
 *   npx tsx --env-file=.env tests/staging/extraction-blind-run.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { createModelClient, createEmbedder } from '../../apps/api/src/container.js';
import { resolveTranscript } from '../../apps/api/src/services/import/resolve.js';
import { isZip, unzipTextEntries } from '../../apps/api/src/services/import/zip.js';
import { parseWhatsAppExport } from '../../apps/api/src/services/import/whatsapp.js';
import { renderThread } from '../../apps/api/src/services/import/dedup.js';
import { redactSensitive } from '../../apps/api/src/services/redaction/redact.js';
import { assignSpeakerRoles } from '../../apps/api/src/services/import/unanswered.js';
import { detectMisfileAtImport } from '../../apps/api/src/services/import/misfile.js';
import { ExtractionService } from '../../apps/api/src/services/extraction/extraction-service.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { extractJsonObject } from '../../apps/api/src/services/extraction/parse.js';
import { ModelBudget, callCostUsd, USD_TO_AED } from '../../apps/api/src/services/metrics/model-budget.js';
import { ImportCostMetrics } from '../../apps/api/src/services/metrics/import-cost-metrics.js';
import { MatchingService } from '../../apps/api/src/services/inventory/matching-service.js';
import { InMemoryClientRepository } from '../../apps/api/src/adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../apps/api/src/adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../apps/api/src/adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../apps/api/src/adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryRequirementRepository } from '../../apps/api/src/adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryInventoryRepository } from '../../apps/api/src/adapters/inventory/in-memory-inventory-repository.js';
import { InMemoryInventoryMatchRepository } from '../../apps/api/src/adapters/inventory/in-memory-inventory-match-repository.js';
import { InMemoryMeetingRepository } from '../../apps/api/src/adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryContactAliasRepository, InMemoryRepNameRepository } from '../../apps/api/src/adapters/import/in-memory-contact-alias-repository.js';
import type { ModelClient, ModelCompletionRequest } from '../../apps/api/src/ports/model.js';

const USER = 'blind-rep';
const TODAY = new Date().toISOString().slice(0, 10);
const aed = (usd: number) => usd * USD_TO_AED;

// The exports to run come from the environment — never hardcoded; no client names or export paths live
// in this repo. Set STAGING_EXPORTS to a JSON array of {zip,client,difficulty}, pointing at LOCAL export
// files (chat exports are gitignored and never committed).
//   STAGING_EXPORTS='[{"zip":"/path/a.zip","client":"A","difficulty":"easy"}]' tsx tests/staging/extraction-blind-run.ts
const EXPORTS: Array<{ zip: string; client: string; difficulty: string }> = (() => {
  const raw = process.env.STAGING_EXPORTS;
  if (!raw) { console.error('set STAGING_EXPORTS to a JSON array of {zip,client,difficulty} (local export files)'); process.exit(1); }
  const parsed = JSON.parse(raw) as Array<{ zip: string; client: string; difficulty: string }>;
  if (!Array.isArray(parsed) || parsed.length === 0) { console.error('STAGING_EXPORTS must be a non-empty JSON array'); process.exit(1); }
  return parsed;
})();

// Counts derived from the raw transcript text (the parser skips system lines, so count them here).
const TS_PREFIX = /^(?:\[[^\]]+\]\s*|\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?\s*-\s*)/;
const HAS_SENDER = /^(?:\[[^\]]+\]\s*|\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?\s*-\s*)[^:]+?:\s/;
const MEDIA = /(?:<\s*media\s+omitted\s*>|\bimage omitted\b|\bvideo omitted\b|<\s*attached:)/i;
const DELETED = /(?:this message was deleted|you deleted this message)/i;
function markerCounts(text: string) {
  let system = 0, continuation = 0, media = 0, deleted = 0;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/[\u200e\u200f\u202f\u00a0\u2007\u2060\ufeff]/g, '');
    if (MEDIA.test(line)) media++;
    if (DELETED.test(line)) deleted++;
    if (HAS_SENDER.test(line)) continue; // a real message header
    if (TS_PREFIX.test(line)) system++; // dated but no sender → system notice
    else if (line.trim()) continuation++; // non-dated, non-blank → continuation of prior message
  }
  return { system, continuation, media, deleted };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic + a real key in .env'); process.exit(1); }

  // ModelBudget — estimate FIRST. 3 imports (one extraction call each) + a tiny warm-up. The hard
  // export is the wildcard; budget generously and abort if we blow past it.
  const budget = new ModelBudget(2.0, 0.5);
  console.log(`ESTIMATE: $${(2.0).toFixed(2)} (AED ${aed(2.0).toFixed(2)}) for 3 imports + warm-up, Sonnet warm. Aborts at +50%.`);

  // Real Sonnet, wrapped to capture each call's text + usage and feed the budget.
  const inner = createModelClient(config, 'extraction');
  const calls: Array<{ text: string; usage: NonNullable<Awaited<ReturnType<ModelClient['complete']>>['usage']> }> = [];
  const model: ModelClient = {
    complete: async (req: ModelCompletionRequest) => {
      const res = await inner.complete(req);
      const usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      calls.push({ text: res.text, usage });
      budget.record('extraction', config.anthropicModel, usage);
      budget.check();
      return res;
    },
  };

  const embedder = createEmbedder(config); // stub locally — extraction embeds best-effort, non-fatal
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const logs = new InMemoryExtractionLogRepository();
  const requirements = new InMemoryRequirementRepository();
  const inventoryRepo = new InMemoryInventoryRepository();
  const matches = new InMemoryInventoryMatchRepository();
  const matching = new MatchingService(matches, requirements, inventoryRepo);
  const meetings = new InMemoryMeetingRepository();
  const importCost = new ImportCostMetrics();
  const aliasesRepo = new InMemoryContactAliasRepository();
  const repNames = new InMemoryRepNameRepository();
  const extraction = new ExtractionService(
    model, clients, notes, facts, embedder, logs, config.anthropicModel,
    undefined, undefined, undefined, '1h', meetings, async () => 'Asia/Dubai', requirements, matching, importCost, undefined,
    (uid, cid) => aliasesRepo.listByClient(uid, cid),
  );

  // Warm-up: prime the cached prefix so the three exports run WARM (the batch asks for warm).
  console.log('warm-up: priming the extraction prefix cache…');
  for (let i = 0; i < 2; i++) {
    await model.complete({ system: EXTRACTION_SYSTEM_PROMPT, cacheSystemPrompt: true, cacheTtl: '1h', maxTokens: 2048, messages: [{ role: 'user', content: buildUserMessage({ today: TODAY, clientName: 'WarmCo', source: 'paste', text: `warm ${i}` }) }] });
  }
  const warmupUsd = budget.totalUsd();
  console.log(`warm-up done: $${warmupUsd.toFixed(4)} (AED ${aed(warmupUsd).toFixed(3)})`);

  const out: string[] = ['# Extraction blind test — results\n', `Run ${new Date().toISOString()} · Sonnet (${config.anthropicModel}), warm · today=${TODAY}. Answer key NOT known to the runner.\n`];
  const anomalies: string[] = [];

  for (const exp of EXPORTS) {
    console.log(`\n=== ${exp.difficulty.toUpperCase()}: ${exp.zip} → "${exp.client}" ===`);
    out.push(`\n---\n\n## ${exp.difficulty.toUpperCase()} — ${exp.zip} → client "${exp.client}"\n`);
    const buf = readFileSync(exp.zip);

    // --- Import mechanics: unzip + content-based transcript selection ---
    const entries = isZip(buf) ? unzipTextEntries(buf) : { ok: true as const, entries: [{ name: '(bare buffer)', text: buf.toString('utf8') }] };
    const entryReport = entries.ok ? entries.entries.map((e) => { const r = ((): boolean => { try { const p = parseWhatsAppExport(e.text); return p.ok && p.messages.length > 0; } catch { return false; } })(); return `${e.name} (${e.text.length} chars, ${r ? 'PARSES' : 'not a transcript'})`; }) : [];
    const resolved = resolveTranscript(buf);
    if (!resolved.ok) { anomalies.push(`${exp.zip}: resolveTranscript failed — ${resolved.reason}`); out.push(`**resolveTranscript FAILED:** ${resolved.reason}\n`); continue; }
    const selectedEntry = entries.ok ? entries.entries.find((e) => e.text === resolved.text)?.name ?? '(unknown)' : '(bare)';
    const text = resolved.text;

    const parsed = parseWhatsAppExport(text);
    if (!parsed.ok) { anomalies.push(`${exp.zip}: parse failed — ${parsed.reason}`); out.push(`**parse FAILED:** ${parsed.reason}\n`); continue; }
    const speakers = [...new Set(parsed.messages.map((m) => m.sender))];
    const dated = parsed.messages.map((m) => m.sentAt).filter((s): s is string => !!s).sort();
    const mk = markerCounts(text);

    out.push('### 1. Import mechanics\n');
    out.push(`- **Text-file entries in the zip** (transcript chosen by CONTENT): ${entryReport.join('; ')}`);
    out.push(`- **Selected transcript:** \`${selectedEntry}\``);
    out.push(`- **Parsed messages:** ${parsed.messages.length} · **speakers:** ${speakers.join(', ')} · **date range:** ${dated[0] ?? '—'} → ${dated.at(-1) ?? '—'}`);
    out.push(`- **Markers:** ${mk.continuation} continuation lines · ${mk.media} media · ${mk.deleted} deleted · ${mk.system} system lines (system skipped by the parser)`);

    // --- Confirm gate (before any model call) ---
    const callsBefore = calls.length;
    const repName = await repNames.get(USER);
    const client = await clients.create(USER, exp.client);
    const selectedAliases = await aliasesRepo.listByClient(USER, client.id);
    const priors = await clients.listByUser(USER);
    const others = await Promise.all(priors.filter((c) => c.id !== client.id).map(async (c) => ({ id: c.id, name: c.name, phone: c.phone, aliases: await aliasesRepo.listByClient(USER, c.id), knownPeople: [] as string[] })));
    const redacted = parsed.messages.map((m) => ({ ...m, body: redactSensitive(m.body).redacted }));
    const redactCount = redacted.filter((m, i) => m.body !== parsed.messages[i]!.body).length;
    const detection = detectMisfileAtImport({ messages: redacted, selected: { id: client.id, name: client.name, phone: client.phone, aliases: selectedAliases }, knownPeople: [], others, repName });
    const modelCallsDuringGate = calls.length - callsBefore;

    out.push(`- **Counterpart by elimination:** ${detection.counterpart ?? '(none/ambiguous)'} · rep name known: ${repName ?? '(not yet)'} · group chat: ${detection.group}`);
    out.push(`- **Mismatch prompt fired:** ${detection.status === 'mismatch' ? 'YES' : 'no'}${detection.status === 'mismatch' && detection.suggestion ? ` (suggested: ${detection.suggestion.name})` : ''}`);
    out.push(`- **Model calls before confirmation:** ${modelCallsDuringGate} ${modelCallsDuringGate === 0 ? '✓ (none — the gate is free)' : '✗ SPENT BEFORE CONFIRM'}`);
    if (modelCallsDuringGate !== 0) anomalies.push(`${exp.zip}: ${modelCallsDuringGate} model call(s) before confirmation`);

    // The rep confirms (as instructed). Learn alias + rep name exactly as the route does.
    let confirmed = false;
    if (detection.status === 'mismatch' && !detection.group && detection.counterpart) {
      await aliasesRepo.add(USER, client.id, detection.counterpart);
      confirmed = true;
    }
    if (detection.learnRepName && !repName) await repNames.set(USER, detection.learnRepName);
    out.push(`- **Rep confirmed:** ${confirmed ? `yes → learned alias "${detection.counterpart}" for ${client.name}` : detection.status === 'ok' ? 'no prompt (counterpart matched)' : 'prompt fired but no single counterpart to alias'}${detection.learnRepName && !repName ? ` · learned rep name "${detection.learnRepName}"` : ''}`);

    // --- Store + extract (the sweep's step), timing the real model call ---
    const messages = assignSpeakerRoles(redacted, client.name);
    const note = await notes.create(USER, { clientId: client.id, source: 'whatsapp_export', rawText: renderThread(messages), audioKey: null, status: 'pending_extraction', messages });
    const startCall = calls.length;
    const t0 = Date.now();
    const outcome = await extraction.extractNote(USER, note.id, TODAY);
    const ms = Date.now() - t0;
    const myCalls = calls.slice(startCall);
    const usageSum = myCalls.reduce((a, c) => ({ i: a.i + c.usage.inputTokens, o: a.o + c.usage.outputTokens, cr: a.cr + (c.usage.cacheReadInputTokens ?? 0), cw: a.cw + (c.usage.cacheCreationInputTokens ?? 0) }), { i: 0, o: 0, cr: 0, cw: 0 });
    const usd = myCalls.reduce((s, c) => s + callCostUsd(config.anthropicModel, c.usage), 0);
    out.push(`- **Extraction:** status \`${outcome.status}\` · ${myCalls.length} model call(s) · ${ms}ms · in ${usageSum.i} / out ${usageSum.o} · cache read ${usageSum.cr} / write ${usageSum.cw} · **$${usd.toFixed(4)} (AED ${aed(usd).toFixed(3)})**`);
    if (outcome.status === 'needs_review') anomalies.push(`${exp.zip}: extraction → needs_review (model output failed validation twice)`);

    // --- 2. Verbatim model output (the LAST call's raw text) ---
    out.push('\n### 2. Complete model output — verbatim (raw JSON the model returned)\n');
    const rawText = myCalls.at(-1)?.text ?? '(no model output)';
    const rawParsed = extractJsonObject(rawText);
    out.push('```json\n' + (rawParsed ? JSON.stringify(rawParsed, null, 2) : rawText) + '\n```');

    // --- 3. What landed in the vault ---
    const stored = await notes.findByIdForUser(USER, note.id);
    const promises = (await facts.listPromisesByUser(USER)).filter((p) => p.clientId === client.id);
    const keyDates = (await facts.listKeyDatesByUser(USER)).filter((k) => k.clientId === client.id);
    const reqs = await requirements.listByClient(USER, client.id);
    out.push('\n### 3. What landed in the vault (stored state)\n');
    out.push('```json\n' + JSON.stringify({
      noteStatus: stored?.status,
      storedExtraction: stored?.extracted,
      promises, keyDates,
      requirements: reqs.map((r) => ({ text: r.text, requirementRaw: r.requirementRaw, statedOn: r.statedOn, status: r.status, confidence: r.confidence })),
    }, null, 2) + '\n```');

    // --- 4. System actions ---
    out.push('\n### 4. What the system did on its own\n');
    const lowConf = promises.filter((p) => p.confidence === 'low');
    out.push(`- Redactions applied to ${redactCount} message(s) (counts only, never values).`);
    out.push(`- Move suggestion on the note: ${stored?.moveSuggestion ? JSON.stringify(stored.moveSuggestion) : 'none'}`);
    out.push(`- Low-confidence promises routed to the confirm queue: ${lowConf.length}`);
    out.push(`- Note left needs_review: ${stored?.status === 'needs_review' ? 'YES' : 'no'}`);
    out.push(`- Unanswered questions detected: ${(stored?.extracted as { unanswered_questions?: unknown[] } | null)?.unanswered_questions?.length ?? 0}`);
  }

  const rep = budget.report();
  out.push(`\n---\n\n## Cost summary\n\nTotal model spend: **$${rep.totalUsd.toFixed(4)} (AED ${rep.totalAed.toFixed(2)})** vs estimate $${rep.estimateUsd.toFixed(2)}. Warm-up: $${warmupUsd.toFixed(4)}.\n`);
  out.push(`## Anomalies / unexpected behaviour\n\n${anomalies.length ? anomalies.map((a) => `- ${a}`).join('\n') : '- None observed during the run.'}\n`);

  writeFileSync('EXTRACTION-TEST-RESULTS.md', out.join('\n') + '\n');
  console.log(`\nwrote EXTRACTION-TEST-RESULTS.md · total $${rep.totalUsd.toFixed(4)} (AED ${rep.totalAed.toFixed(2)})`);
}

main().catch((e) => { console.error('RUN FAILED:', e); process.exit(1); });
