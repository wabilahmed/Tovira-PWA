/**
 * [BLIND-2] A large WhatsApp export through the REAL import path on a WORKING engine (max_tokens 20k,
 * MODEL_TIMEOUT_MS 300s, client-as-person v0.9.4). The first blind test never got past the empty-output
 * bug — this is the first time it lands end to end. (Supply your own local export; none is committed.)
 *
 * Blind rules: report, do NOT grade. No tuning, no retries, no adjustment. If it errors, stop + report.
 *
 * TWO extraction runs, cost for both (owner's ask):
 *   - WARM: full real path (unzip → resolve → parse → confirm gate → extract → vault → Book Scan),
 *     with the 1h-cache prefix primed → the prefix reads warm.
 *   - UNCACHED: the SAME extraction input replayed with cacheSystemPrompt=false → no cache at all.
 * The transcript is the variable message and is uncached in BOTH; only the ~prefix differs.
 *
 *   STAGING_ZIP=path/to/export.zip STAGING_CLIENT="Client Name" \
 *     npx tsx --env-file=.env tests/staging/blind-test-2.ts
 *   (or pass them as argv: tests/staging/blind-test-2.ts <zip> <client>)
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
import { ExtractionService, referenceDateFor } from '../../apps/api/src/services/extraction/extraction-service.js';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { extractJsonObject } from '../../apps/api/src/services/extraction/parse.js';
import { isStalePromise } from '../../apps/api/src/services/facts/promise-lifecycle.js';
import { pendingConfirmations } from '../../apps/api/src/services/facts/confirmation.js';
import { BookScanService } from '../../apps/api/src/services/book-scan/book-scan-service.js';
import { ModelBudget, callCostUsd, estimateEmbedUsd, USD_TO_AED } from '../../apps/api/src/services/metrics/model-budget.js';
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
import type { ModelClient, ModelCompletionRequest, ModelUsage } from '../../apps/api/src/ports/model.js';

const USER = 'blind-rep';
const TODAY = new Date().toISOString().slice(0, 10);
const NOW_MS = Date.now();
// Export path + client name come from the environment (or argv) — never hardcoded; no client data lives
// in this repo. Supply a local export when running; it stays local (chat exports are gitignored).
function required(v: string | undefined, usage: string): string {
  if (!v) { console.error(usage); process.exit(1); }
  return v;
}
const USAGE = 'usage: STAGING_ZIP=<path> STAGING_CLIENT="<name>" tsx tests/staging/blind-test-2.ts (or pass as argv[2]/[3])';
const ZIP = required(process.env.STAGING_ZIP ?? process.argv[2], USAGE);
const CLIENT = required(process.env.STAGING_CLIENT ?? process.argv[3], USAGE);
const aed = (usd: number) => usd * USD_TO_AED;
const usd4 = (n: number) => `$${n.toFixed(4)}`;

// System-line counting from raw text (the parser skips them).
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
    if (HAS_SENDER.test(line)) continue;
    if (TS_PREFIX.test(line)) system++;
    else if (line.trim()) continuation++;
  }
  return { system, continuation, media, deleted };
}

interface Cap { req: ModelCompletionRequest; text: string; usage: ModelUsage }

function costLine(label: string, usage: ModelUsage, model: string, msgs: number): string[] {
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const freshIn = usage.inputTokens ?? 0;
  const totalIn = freshIn + cacheRead + cacheWrite;
  const thinking = usage.thinkingTokens ?? 0;
  const out = usage.outputTokens ?? 0;
  const text = out - thinking;
  const u = callCostUsd(model, usage);
  const hit = totalIn ? (cacheRead / totalIn) * 100 : 0;
  const per1k = msgs ? aed(u) / (msgs / 1000) : 0;
  return [
    `**${label}**`,
    `- input: ${totalIn} total = ${freshIn} uncached (fresh) + ${cacheRead} cache-read + ${cacheWrite} cache-write`,
    `- output: ${out} total = **${thinking} thinking** + ${text} text (thinking billed as output)`,
    `- cache hit rate: ${hit.toFixed(1)}% (cache-read ÷ total input)`,
    `- model cost: ${usd4(u)} (AED ${aed(u).toFixed(3)})`,
    `- cost per 1,000 messages: AED ${per1k.toFixed(3)}`,
  ];
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic + a real key in .env'); process.exit(1); }

  const budget = new ModelBudget(2.5, 0.5); // two big extraction calls + warm-up
  console.log(`ESTIMATE: ~$1.4 (AED ~5.1) — hard export extracted TWICE (warm + uncached, ~170k input each) + warm-up. Budget $2.50, aborts at +50%.`);

  const inner = createModelClient(config, 'extraction');
  const caps: Cap[] = [];
  const model: ModelClient = {
    complete: async (req: ModelCompletionRequest) => {
      const res = await inner.complete(req);
      const usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      caps.push({ req, text: res.text, usage });
      budget.record('extraction', config.anthropicModel, usage);
      budget.check();
      return res;
    },
  };

  const embedder = createEmbedder(config); // STUB locally — embeddings estimated, not a real Titan call
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

  // Warm-up: prime the 1h-cache prefix so the WARM run reads it. (Byte-identical prefix, any max_tokens.)
  console.log('warm-up: priming the 1h extraction prefix cache…');
  for (let i = 0; i < 2; i++) {
    await model.complete({ system: EXTRACTION_SYSTEM_PROMPT, cacheSystemPrompt: true, cacheTtl: '1h', maxTokens: 2048, messages: [{ role: 'user', content: buildUserMessage({ today: TODAY, clientName: 'WarmCo', source: 'paste', text: `warm ${i}` }) }] });
  }
  const out: string[] = [`# BLIND TEST 2 — hard export on a working engine\n`, `Run ${new Date().toISOString()} · Sonnet (${config.anthropicModel}) · today=${TODAY} · answer key NOT known to the runner. Report only.\n`];
  const anomalies: string[] = [];

  // ── 1. Import mechanics ──
  out.push('## 1. Import mechanics\n');
  const buf = readFileSync(ZIP);
  const entries = isZip(buf) ? unzipTextEntries(buf) : { ok: true as const, entries: [] };
  const entryReport = entries.ok ? entries.entries.map((e) => { let ok = false; try { const p = parseWhatsAppExport(e.text); ok = p.ok && p.messages.length > 0; } catch { ok = false; } return `\`${e.name}\` (${e.text.length} chars, ${ok ? 'PARSES as transcript' : 'NOT a transcript'})`; }) : [];
  const resolved = resolveTranscript(buf);
  if (!resolved.ok) { anomalies.push(`resolveTranscript failed: ${resolved.reason}`); out.push(`**resolveTranscript FAILED:** ${resolved.reason}\n`); writeFileSync('BLIND-TEST-2-RESULTS.md', out.join('\n')); process.exit(1); }
  const selectedEntry = entries.ok ? entries.entries.find((e) => e.text === resolved.text)?.name ?? '(unknown)' : '(bare)';
  const tParse0 = Date.now();
  const parsed = parseWhatsAppExport(resolved.text);
  const parseMs = Date.now() - tParse0;
  if (!parsed.ok) { anomalies.push(`parse failed: ${parsed.reason}`); out.push(`**parse FAILED:** ${parsed.reason}\n`); writeFileSync('BLIND-TEST-2-RESULTS.md', out.join('\n')); process.exit(1); }
  const speakers = [...new Set(parsed.messages.map((m) => m.sender))];
  const dated = parsed.messages.map((m) => m.sentAt).filter((s): s is string => !!s).sort();
  const mk = markerCounts(resolved.text);
  out.push(`- **Zip text entries** (transcript chosen by CONTENT, not filename — a \`notes.txt\` decoy is present): ${entryReport.join('; ')}`);
  out.push(`- **Selected transcript:** \`${selectedEntry}\``);
  out.push(`- **Parsed messages:** ${parsed.messages.length} · **speakers:** ${speakers.join(', ')} · **date range:** ${dated[0] ?? '—'} → ${dated.at(-1) ?? '—'}`);
  out.push(`- **Markers:** ${mk.continuation} continuation · ${mk.media} media · ${mk.deleted} deleted · ${mk.system} system lines (parser skips system)`);
  out.push(`- **Parse wall-clock:** ${parseMs}ms`);

  // ── Confirm gate (must be pre-model-call) ──
  const callsBeforeGate = caps.length;
  const repName = await repNames.get(USER);
  const client = await clients.create(USER, CLIENT);
  const selectedAliases = await aliasesRepo.listByClient(USER, client.id);
  const redacted = parsed.messages.map((m) => ({ ...m, body: redactSensitive(m.body).redacted }));
  const redactCount = redacted.filter((m, i) => m.body !== parsed.messages[i]!.body).length;
  const detection = detectMisfileAtImport({ messages: redacted, selected: { id: client.id, name: client.name, phone: client.phone, aliases: selectedAliases }, knownPeople: [], others: [], repName });
  const gateModelCalls = caps.length - callsBeforeGate;
  out.push(`- **Counterpart by elimination:** ${detection.counterpart ?? '(none/ambiguous)'} · group chat: ${detection.group} · rep name known: ${repName ?? '(not yet)'}`);
  out.push(`- **Alias mismatch prompt fired:** ${detection.status === 'mismatch' ? `YES (client "${client.name}" vs counterpart "${detection.counterpart}")` : 'no'}`);
  out.push(`- **Model calls during the confirm gate:** ${gateModelCalls} ${gateModelCalls === 0 ? '✓ (gate is free — fired before any model call)' : '✗ SPENT BEFORE CONFIRM'}`);
  if (gateModelCalls !== 0) anomalies.push(`${gateModelCalls} model call(s) before confirmation`);
  let confirmed = false;
  if (detection.status === 'mismatch' && !detection.group && detection.counterpart) { await aliasesRepo.add(USER, client.id, detection.counterpart); confirmed = true; }
  if (detection.learnRepName && !repName) await repNames.set(USER, detection.learnRepName);
  out.push(`- **Rep confirmed the mismatch:** ${confirmed ? `yes → learned alias "${detection.counterpart}" = ${client.name}` : '(no single counterpart to alias)'}${detection.learnRepName ? ` · learned rep name "${detection.learnRepName}"` : ''}`);

  // ── WARM run: store + extract through the real path ──
  const messages = assignSpeakerRoles(redacted, client.name);
  const note = await notes.create(USER, { clientId: client.id, source: 'whatsapp_export', rawText: renderThread(messages), audioKey: null, status: 'pending_extraction', messages });
  const refDate = referenceDateFor({ messages }, TODAY);
  const startWarm = caps.length;
  const tExt0 = Date.now();
  const outcome = await extraction.extractNote(USER, note.id, TODAY);
  const extMs = Date.now() - tExt0;
  const warmCalls = caps.slice(startWarm);
  out.push(`- **Extraction (warm):** status \`${outcome.status}\` · ${warmCalls.length} model call(s) · **${extMs}ms wall-clock** · reference date resolved to ${refDate} (last message, not import clock)`);
  if (outcome.status === 'needs_review') anomalies.push('extraction → needs_review (model output failed validation twice)');

  // The main extraction call = the largest-input warm call.
  const warmMain = [...warmCalls].sort((a, b) => (b.usage.inputTokens ?? 0) - (a.usage.inputTokens ?? 0))[0];
  if (!warmMain) { anomalies.push('no warm extraction call captured'); }

  // ── UNCACHED run: replay the EXACT same extraction input with caching OFF ──
  console.log('uncached run: replaying the same extraction input with cacheSystemPrompt=false…');
  let uncached: Cap | undefined;
  if (warmMain) {
    const res = await model.complete({ system: EXTRACTION_SYSTEM_PROMPT, cacheSystemPrompt: false, messages: warmMain.req.messages, maxTokens: EXTRACTION_MAX_TOKENS });
    uncached = caps.at(-1);
    void res;
  }

  // ── 2. Cost, exactly (both runs) ──
  out.push('\n## 2. Cost — WARM (1h cache) vs UNCACHED\n');
  out.push('One extraction call per run — the transcript is sent as a SINGLE call, not chunked.\n');
  const msgs = parsed.messages.length;
  if (warmMain) out.push(costLine('WARM run (1h-cache prefix primed)', warmMain.usage, config.anthropicModel, msgs).join('\n'));
  out.push('');
  if (uncached) out.push(costLine('UNCACHED run (cacheSystemPrompt=false)', uncached.usage, config.anthropicModel, msgs).join('\n'));
  // Embedding (estimated — stub embedder locally; real Titan in prod).
  const reqCountForEmbed = (await requirements.listByClient(USER, client.id)).length;
  const rawLen = note.rawText?.length ?? 0;
  const embedUsd = estimateEmbedUsd(rawLen, reqCountForEmbed);
  const warmUsd = warmMain ? callCostUsd(config.anthropicModel, warmMain.usage) : 0;
  const uncUsd = uncached ? callCostUsd(config.anthropicModel, uncached.usage) : 0;
  out.push('\n**Embeddings (estimated — stub embedder locally, real Titan/Bedrock in prod):**');
  out.push(`- note + ${reqCountForEmbed} requirement vector(s) over ${rawLen} chars → ${usd4(embedUsd)} (AED ${aed(embedUsd).toFixed(4)})`);
  out.push('\n**Itemised totals:**');
  out.push(`| component | WARM | UNCACHED |`);
  out.push(`|---|---|---|`);
  out.push(`| model (Sonnet) | ${usd4(warmUsd)} / AED ${aed(warmUsd).toFixed(3)} | ${usd4(uncUsd)} / AED ${aed(uncUsd).toFixed(3)} |`);
  out.push(`| embeddings (est.) | ${usd4(embedUsd)} / AED ${aed(embedUsd).toFixed(4)} | ${usd4(embedUsd)} / AED ${aed(embedUsd).toFixed(4)} |`);
  out.push(`| **total** | **${usd4(warmUsd + embedUsd)} / AED ${aed(warmUsd + embedUsd).toFixed(3)}** | **${usd4(uncUsd + embedUsd)} / AED ${aed(uncUsd + embedUsd).toFixed(3)}** |`);
  out.push(`| per 1,000 msgs (model) | AED ${(aed(warmUsd) / (msgs / 1000)).toFixed(3)} | AED ${(aed(uncUsd) / (msgs / 1000)).toFixed(3)} |`);
  const delta = uncUsd - warmUsd;
  out.push(`\n**Warm vs uncached delta:** ${usd4(delta)} (AED ${aed(delta).toFixed(3)}) — caching only touches the ~prefix; the ~${msgs}-message transcript is the variable message and is uncached in BOTH runs, so it dominates either way.`);
  out.push(`**vs the last measured ~AED 2.5 warm for a large import:** warm here = AED ${aed(warmUsd + embedUsd).toFixed(2)}.`);

  // ── 3. Complete model output — verbatim ──
  out.push('\n## 3. Complete extraction output — verbatim (raw JSON the model returned)\n');
  const rawText = warmMain?.text ?? '(no output)';
  const rawParsed = extractJsonObject(rawText);
  out.push('```json\n' + (rawParsed ? JSON.stringify(rawParsed, null, 2) : rawText) + '\n```');

  // ── 4. What landed in the vault (vs raw) ──
  const stored = await notes.findByIdForUser(USER, note.id);
  const promises = (await facts.listPromisesByUser(USER)).filter((p) => p.clientId === client.id);
  const keyDates = (await facts.listKeyDatesByUser(USER)).filter((k) => k.clientId === client.id);
  const reqs = await requirements.listByClient(USER, client.id);
  const ex = (stored?.extracted ?? {}) as Record<string, unknown>;
  const storedPromises = promises.map((p) => ({ text: p.text, owner: p.owner, dueDate: p.dueDate, confidence: p.confidence, state: isStalePromise(p, NOW_MS, config.promiseStaleThresholdDays) ? 'STALE' : 'active' }));
  const confirmQueue = pendingConfirmations(promises);
  out.push('\n## 4. What landed in the vault (stored state)\n');
  out.push('```json\n' + JSON.stringify({
    noteStatus: stored?.status,
    promises_spine: storedPromises,
    requirements_spine: reqs.map((r) => ({ text: r.text, requirementRaw: r.requirementRaw, statedOn: r.statedOn, status: r.status, confidence: r.confidence })),
    key_dates_spine: keyDates.map((k) => ({ description: k.description, date: k.date, dateRaw: k.dateRaw, type: k.type })),
    people: ex.people ?? [],
    personal_facts: ex.personal_facts ?? [],
    concerns: ex.concerns ?? [],
    next_steps: ex.next_steps ?? [],
    meeting_persisted: await meetings.findByNoteId(USER, note.id),
    confirmation_queue: confirmQueue.map((p) => ({ text: p.text, why: p.confidence === 'low' ? 'low confidence' : 'unresolved date' })),
  }, null, 2) + '\n```');
  // Raw vs stored divergence.
  const rawObj = (rawParsed ?? {}) as Record<string, unknown>;
  const rawProms = Array.isArray(rawObj.promises) ? rawObj.promises as Array<{ due_date: string | null }> : [];
  const clampedDates = rawProms.filter((p) => p.due_date !== null).length - storedPromises.filter((p) => p.dueDate !== null).length;
  const staleCount = storedPromises.filter((p) => p.state === 'STALE').length;
  out.push('\n**Raw → stored divergence (which layer):**');
  out.push(`- raw promises: ${rawProms.length} · stored promises: ${promises.length}${rawProms.length !== promises.length ? ` → ${rawProms.length - promises.length} dropped (dedupe / owner filter)` : ' (no dedupe drop)'}`);
  out.push(`- promise due_dates present in raw but null in vault: ~${Math.max(0, clampedDates)} (DATE-INVARIANT — a promise can't be due before the note's reference date ${refDate})`);
  out.push(`- promises now STALE at surfacing: ${staleCount}/${promises.length} (90-day rule — this import's dates are years past today ${TODAY}; staleness is a COMPUTED surface, not stored)`);
  out.push(`- redaction applied to ${redactCount} message(s) on the INPUT before the model saw it (values never reach extraction)`);

  // ── 5. What the system did on its own ──
  out.push('\n## 5. What the system did on its own\n');
  const bookScan = new BookScanService({ clients, notes, facts }, { coldThresholdDays: config.coldThresholdDays, upcomingWindowDays: 30, promiseStaleThresholdDays: config.promiseStaleThresholdDays });
  const scan = await bookScan.scan(USER, NOW_MS);
  const openPromiseItems = scan.items.filter((i) => i.kind === 'open_promise').length;
  out.push(`- **Redactions:** ${redactCount} message(s) redacted at ingest (counts only, never values).`);
  out.push(`- **Confirmation queue:** ${confirmQueue.length} promise(s) routed to confirm (low-confidence / unresolved date).`);
  out.push(`- **needs_review:** ${stored?.status === 'needs_review' ? 'YES — model output failed validation twice' : 'no'}.`);
  out.push(`- **Move suggestion (misfile):** ${stored?.moveSuggestion ? JSON.stringify(stored.moveSuggestion) : 'none'}.`);
  out.push(`- **Book Scan — surfaced vs counted (import-flood rule):** LISTED ${openPromiseItems} recoverable open-promise item(s); COUNTED ${scan.stalePromises} older (stale) promise(s) not listed. Unanswered questions surfaced: ${scan.items.filter((i) => i.kind === 'unanswered_question').length}. Going-cold: ${scan.items.filter((i) => i.kind === 'going_cold').length}. Upcoming dates: ${scan.items.filter((i) => i.kind === 'upcoming_date').length}.`);
  out.push(`- **Promises entering STALE directly on import:** ${staleCount} (arrived overdue past the 90-day window → never active).`);

  // ── 6. Anything unexpected ──
  out.push('\n## 6. Anything unexpected\n');
  const rep = budget.report();
  out.push(anomalies.length ? anomalies.map((a) => `- ${a}`).join('\n') : '- Nothing errored, timed out, or retried during the run.');
  out.push(`\n---\n**Run totals:** model spend ${usd4(rep.totalUsd)} (AED ${rep.totalAed.toFixed(2)}) across ${caps.length} calls (incl. warm-up + the uncached probe) vs estimate $${rep.estimateUsd.toFixed(2)}.`);

  writeFileSync('BLIND-TEST-2-RESULTS.md', out.join('\n') + '\n');
  console.log(`\nwrote BLIND-TEST-2-RESULTS.md · total ${usd4(rep.totalUsd)} (AED ${rep.totalAed.toFixed(2)})`);
}

main().catch((e) => { console.error('RUN FAILED:', e); process.exit(1); });
