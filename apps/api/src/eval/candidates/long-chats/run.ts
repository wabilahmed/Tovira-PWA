/**
 * [P23-B3/B5] Run the long-chat candidates through the SHIPPED extraction path (ExtractionService over
 * in-memory stores, exactly as an imported chat is processed: speaker roles, date resolution, the receipt
 * guard, and — when EXTRACT_WINDOWED=1 — windowed extraction), then score the stored extraction.
 *
 *   ( set -a; . ~/.config/tovira/eval.env; set +a;
 *     ANTHROPIC_API_KEY="$TOVIRA_EVAL_ANTHROPIC_KEY" MODEL_PROVIDER=anthropic DATABASE_URL=postgres://x@localhost/x \
 *     MODEL_EXTRACT=claude-sonnet-5-5 EFFORT_EXTRACT=low GATE_SPEND_CAP_AED=10 \
 *     LONG_CHAT_OUT=/path/to/results LONG_CHAT_LABEL=single npx tsx apps/api/src/eval/candidates/long-chats/run.ts )
 *
 * RESUMABLE: each fixture's result is written to LONG_CHAT_OUT/<label>/<id>.json and a fixture whose file
 * already exists is skipped — a run that stops partway resumes from the fixtures not yet done.
 * Prints only scores, token counts and cost — never config or environment.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../../config.js';
import { createModelClient } from '../../../container.js';
import { ExtractionService } from '../../../services/extraction/extraction-service.js';
import { InMemoryClientRepository } from '../../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../../adapters/embedding/stub.js';
import { parseWhatsAppExport } from '../../../services/import/whatsapp.js';
import { assignSpeakerRoles } from '../../../services/import/unanswered.js';
import type { ModelClient } from '../../../ports/model.js';
import type { Extraction } from '../../../services/extraction/types.js';
import { SpendCap } from '../../spend-cap.js';
import { KeptSuggestionService } from '../../../services/promises/kept-suggestion-service.js';
import { promiseDedupeKey } from '../../../adapters/facts/dedupe.js';
import { InMemoryKeptSuggestionRepository } from '../../../adapters/promises/in-memory-kept-suggestion-repository.js';
import { LONG_CHATS } from './fixtures.js';
import { scoreLongChat } from './score.js';
import { resolveExtractionDates } from '../../../services/extraction/resolve-date.js';
import { IMPORT_FIXTURES } from '../../import-fixtures.js';
import { scoreInvariants } from '../../score-invariants.js';

/** LONG_CHAT_RESCORE=1: re-score stored results (re-running the deterministic date resolution with the
 *  current code) without any model call — for comparing runs made before a resolver/scorer fix. */
function rescore(out: string): void {
  for (const f of LONG_CHATS) {
    const file = join(out, `${f.id}.json`);
    if (!existsSync(file)) continue;
    const r = JSON.parse(readFileSync(file, 'utf8')) as { extraction: Extraction | null; score: unknown; rescored?: boolean };
    if (!r.extraction) continue;
    if (r.extraction.meeting) { r.extraction.meeting.resolved_datetime = undefined; r.extraction.meeting.resolution = undefined; }
    resolveExtractionDates(r.extraction, f.today, f.id, { dayFirst: true, log: () => undefined });
    r.score = scoreLongChat(f.expected, r.extraction, new Set((r as { suggested?: string[] }).suggested ?? []));
    r.rescored = true;
    writeFileSync(file, JSON.stringify(r, null, 1));
    console.log(`[long-chat] rescored ${f.id}`);
  }
}

async function main(): Promise<void> {
  if (process.env.LONG_CHAT_RESCORE === '1') { rescore(join(process.env.LONG_CHAT_OUT ?? './.long-chat-results', process.env.LONG_CHAT_LABEL ?? 'run')); return; }
  const config = loadConfig();
  const modelId = config.models.extraction;
  const out = join(process.env.LONG_CHAT_OUT ?? './.long-chat-results', process.env.LONG_CHAT_LABEL ?? 'run');
  mkdirSync(out, { recursive: true });
  const cap = SpendCap.fromEnv(process.env);
  const real = createModelClient(config, 'extraction');
  let fixtureCalls = 0; let fixtureAed = 0; let fixtureIn = 0; let fixtureOut = 0;
  const model: ModelClient = {
    complete: async (req) => {
      const res = await real.complete(req);
      const u = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      const before = cap.spentAed;
      cap.add(modelId, u);
      fixtureCalls += 1; fixtureAed += cap.spentAed - before; fixtureIn += u.inputTokens + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0); fixtureOut += u.outputTokens;
      return res;
    },
  };
  const only = process.env.LONG_CHAT_ONLY?.split(',');
  // LONG_CHAT_IMPORTS=1: the certified import fixtures ABOVE the window threshold (cert-only), through the
  // same shipped path, scored by the gate's own invariant contract (wrongness gates; recall reported).
  if (process.env.LONG_CHAT_IMPORTS === '1') {
    for (const f of IMPORT_FIXTURES.filter((x) => x.mode === 'invariant' && (!only || only.includes(x.id)))) {
      const file = join(out, `${f.id}.json`);
      if (existsSync(file)) { console.log(`[long-chat] ${f.id}: done already — skipped (resume)`); continue; }
      fixtureCalls = 0; fixtureAed = 0; fixtureIn = 0; fixtureOut = 0;
      const clients = new InMemoryClientRepository();
      const notes = new InMemoryNoteRepository();
      const svc = new ExtractionService(model, clients, notes, new InMemoryFactsRepository(), new StubEmbedder(8), new InMemoryExtractionLogRepository(), modelId,
        undefined, undefined, undefined, '1h', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, config.windowing);
      const client = await clients.create('eval', f.clientName);
      const parsed = parseWhatsAppExport(f.transcript);
      if (!parsed.ok) throw new Error(`${f.id}: transcript did not parse`);
      const note = await notes.create('eval', { clientId: client.id, source: 'whatsapp_export', rawText: f.transcript, audioKey: null, status: 'pending_extraction', messages: assignSpeakerRoles(parsed.messages, f.clientName) });
      const outcome = await svc.extractNote('eval', note.id, f.today);
      const stored = (await notes.findByIdForUser('eval', note.id))?.extracted as Extraction | null;
      const inv = f.mode === 'invariant' && stored ? scoreInvariants(f.contract, stored) : null;
      writeFileSync(file, JSON.stringify({ id: f.id, messages: parsed.messages.length, model: modelId, status: (outcome as { status?: string }).status, calls: fixtureCalls, promptTokens: fixtureIn, outputTokens: fixtureOut, aed: Number(fixtureAed.toFixed(4)), invariant: inv, extraction: stored }, null, 1));
      console.log(`[long-chat] ${f.id} (${parsed.messages.length} msgs): ${inv ? `GATE ${inv.passed ? 'PASS' : 'FAIL'} · recall ${inv.anchorsFound}/${inv.anchorsRequired}${inv.wrongness.length ? ' · WRONGNESS: ' + inv.wrongness.join('; ') : ''}${inv.recallMisses.length ? ' · misses: ' + inv.recallMisses.join('; ') : ''}` : `no extraction (${(outcome as { status?: string }).status})`} · ${fixtureCalls} call(s) · AED ${fixtureAed.toFixed(3)}`);
    }
    console.log(`[long-chat] this invocation AED ${cap.spentAed.toFixed(3)}`);
    return;
  }
  for (const f of LONG_CHATS.filter((x) => !only || only.includes(x.id))) {
    const file = join(out, `${f.id}.json`);
    if (existsSync(file)) { console.log(`[long-chat] ${f.id}: done already — skipped (resume)`); continue; }
    fixtureCalls = 0; fixtureAed = 0; fixtureIn = 0; fixtureOut = 0;
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const kept = new KeptSuggestionService({ suggestions: new InMemoryKeptSuggestionRepository(), facts, clients });
    const svc = new ExtractionService(model, clients, notes, facts, new StubEmbedder(8), new InMemoryExtractionLogRepository(), modelId,
      undefined, undefined, undefined, '1h', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      config.windowing, kept); // EXTRACT_WINDOWED=1 → the shipped windowed path; [P24-2] delivered → suggestion
    const client = await clients.create('eval', f.clientName);
    const parsed = parseWhatsAppExport(f.transcript);
    if (!parsed.ok) throw new Error(`${f.id}: transcript did not parse`);
    const note = await notes.create('eval', { clientId: client.id, source: 'whatsapp_export', rawText: f.transcript, audioKey: null, status: 'pending_extraction', messages: assignSpeakerRoles(parsed.messages, f.clientName) });
    const outcome = await svc.extractNote('eval', note.id, f.today);
    const stored = (await notes.findByIdForUser('eval', note.id))?.extracted as Extraction | null;
    // [P24-2] the promises carrying an open "looks sent — confirm" suggestion (by client + promise key)
    const openKeys = await kept.openKeys('eval');
    const suggestedTexts = new Set((await facts.listPromisesByUser('eval')).filter((p) => openKeys.has(`${p.clientId}|${promiseDedupeKey(p.owner, p.text)}`)).map((p) => p.text.toLowerCase()));
    const score = stored ? scoreLongChat(f.expected, stored, suggestedTexts) : null;
    const result = { suggested: [...suggestedTexts], id: f.id, messages: f.messageCount, model: modelId, status: (outcome as { status?: string }).status, calls: fixtureCalls, promptTokens: fixtureIn, outputTokens: fixtureOut, aed: Number(fixtureAed.toFixed(4)), score, extraction: stored };
    writeFileSync(file, JSON.stringify(result, null, 1));
    const s = score;
    console.log(`[long-chat] ${f.id} (${f.messageCount} msgs): ${s ? `promises ${s.promises.found}/${s.promises.expected} (dates ${s.promiseDates.found}, status ${s.promiseStatus.found}) · reqs ${s.requirements.found}/${s.requirements.expected} · budget ${s.budget.found}/1${s.budget.inSummaryOnly ? ' (summary only)' : ''} (stale ${s.budget.staleAlsoCurrent}) · meetings ${s.meetings.found}/${s.meetings.expected} · keyDates ${s.keyDates.found}/${s.keyDates.expected} · decision ${s.decisionDate ? 'yes' : 'no'} · dups ${s.duplicates} · ${s.pass ? 'PASS' : 'FAIL'}` : `no extraction (${result.status})`} · ${fixtureCalls} call(s) · AED ${fixtureAed.toFixed(3)}`);
    if (s && s.misses.length) console.log(`[long-chat]   misses: ${s.misses.join('; ')}`);
  }
  const total = LONG_CHATS.map((f) => join(out, `${f.id}.json`)).filter(existsSync).reduce((n, p) => n + (JSON.parse(readFileSync(p, 'utf8')) as { aed: number }).aed, 0);
  console.log(`[long-chat] this invocation AED ${cap.spentAed.toFixed(3)} · all results in ${out}: AED ${total.toFixed(3)}`);
}

main().catch((err: unknown) => { console.error(`[long-chat] error: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
