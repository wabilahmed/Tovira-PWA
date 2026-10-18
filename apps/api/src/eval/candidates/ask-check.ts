/**
 * [P23-A3] Ask/aux check: the browser-run Ask scenarios, through the real RecallService (structured
 * cross-client source, sessions, cleanAnswer, every-client completion) on the AUX model, so Haiku 5.5 can
 * be compared with Haiku 4.5 side by side. CANDIDATE tooling — not the certified gate.
 *
 *   ( set -a; . ~/.config/tovira/eval.env; set +a; ANTHROPIC_API_KEY="$TOVIRA_EVAL_ANTHROPIC_KEY" \
 *     MODEL_PROVIDER=anthropic DATABASE_URL=postgres://x@localhost/x MODEL_AUX=claude-haiku-5-5 \
 *     GATE_SPEND_CAP_AED=2 npx tsx apps/api/src/eval/candidates/ask-check.ts )
 *
 * Grounding check per answer: every client the answer names must be on record for that question (in its
 * receipts); the unknown-fact question must come back as "I don't have that on record". Prints the
 * answers, the verdicts and the cost — never config or environment.
 */
import { loadConfig } from '../../config.js';
import { createModelClient } from '../../container.js';
import { RecallService, clientsNamedIn } from '../../services/recall/recall-service.js';
import { StructuredRecall } from '../../services/recall/structured-recall.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryRecallSessionRepository } from '../../adapters/recall/in-memory-recall-session-repository.js';
import type { ModelClient } from '../../ports/model.js';
import { SpendCap } from '../spend-cap.js';

const U = 'ask-check';
const NOW = Date.parse('2026-10-18T09:00:00Z');

async function main(): Promise<void> {
  const config = loadConfig();
  const modelId = config.models.recall;
  const cap = SpendCap.fromEnv(process.env);
  const real = createModelClient(config, 'recall');
  const model: ModelClient = { complete: async (r) => { const res = await real.complete(r); cap.add(modelId, res.usage ?? { inputTokens: 0, outputTokens: 0 }); return res; } };

  // A book shaped like the test rep's.
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const requirements = new InMemoryRequirementRepository();
  const gate = await clients.create(U, 'QA P14 Gate Client');
  const sara = await clients.create(U, 'QA Sara Khan');
  const ahmed = await clients.create(U, 'أحمد الحمادي');
  const enter = await clients.create(U, 'QA Enter Key Client');
  const note = async (clientId: string, extracted: unknown = {}) => { const n = await notes.create(U, { clientId, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted' }); await notes.update(U, n.id, { extracted }); return n.id; };
  await facts.saveExtraction(U, { noteId: await note(gate.id), clientId: gate.id, promises: [
    { text: 'Send three villa options', owner: 'rep', due_date: '2026-10-14', due_raw: 'next week', confidence: 'high' },
    { text: 'send the signed reservation form', owner: 'client', due_date: '2026-10-21', due_raw: null, confidence: 'high' },
  ] });
  await facts.saveExtraction(U, { noteId: await note(sara.id), clientId: sara.id, promises: [{ text: 'Send options for a 2-bed in JVC', owner: 'rep', due_date: '2026-10-22', due_raw: null, confidence: 'high' }] });
  await facts.saveExtraction(U, { noteId: await note(enter.id), clientId: enter.id, promises: [{ text: 'Share the handover checklist', owner: 'rep', due_date: '2026-10-25', due_raw: null, confidence: 'high' }] });
  await requirements.saveForNote(U, await note(gate.id), gate.id, [{ text: 'parking for two cars', requirementRaw: 'need parking for two cars', statedOn: '2026-04-12', confidence: 'high', embedding: null }]);
  await note(ahmed.id, { unanswered_questions: [{ question: 'can you check if parking is included?', sentAt: '2026-03-02T10:15:00', sender: 'أحمد الحمادي' }] });

  const svc = new RecallService({ dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] }, { searchSimilarByUser: async () => [] } as never, model,
    undefined, undefined, modelId, new InMemoryRecallSessionRepository(), undefined, undefined,
    async (u) => (await clients.listByUser(u)).map((c) => ({ id: c.id, name: c.name })), undefined, undefined,
    new StructuredRecall({ facts, meetings, clients, requirements, notes }));
  const dir = (await clients.listByUser(U)).map((c) => ({ id: c.id, name: c.name }));

  const turns: Array<{ q: string; expectClients?: string[]; unknown?: boolean }> = [
    { q: 'Which clients have I promised to send options to?', expectClients: ['QA P14 Gate Client', 'QA Sara Khan'] },
    { q: 'And which of them wanted parking?', expectClients: ['QA P14 Gate Client'] },
    { q: 'What have I promised?', expectClients: ['QA P14 Gate Client', 'QA Sara Khan', 'QA Enter Key Client'] },
    { q: 'Who asked about parking?', expectClients: ['QA P14 Gate Client', 'أحمد الحمادي'] },
    { q: "What is QA Sara Khan's daughter's name?", unknown: true },
  ];
  let invented = 0;
  for (const [i, t] of turns.entries()) {
    const r = await svc.ask(U, t.q, NOW + i * 60_000);
    const onRecord = new Set(r.receipts.map((x) => x.clientId));
    const named = clientsNamedIn(r.answer, dir);
    const notOnRecord = named.filter((c) => !onRecord.has(c.id)).map((c) => c.name);
    const missing = (t.expectClients ?? []).filter((n) => !named.some((c) => c.name === n));
    const unknownOk = !t.unknown || /don't have that on record/i.test(r.answer);
    // "what have I promised" must never present the CLIENT's promise as the rep's.
    const clientPromiseAsMine = /what have i promised/i.test(t.q) && /reservation form/i.test(r.answer) && !/QA P14 Gate Client promised/i.test(r.answer);
    const bad = notOnRecord.length > 0 || !unknownOk || clientPromiseAsMine;
    if (bad) invented += 1;
    console.log(`\n[ask] Q${i + 1}: ${t.q}\n[ask] A: ${r.answer.replace(/\n/g, ' ⏎ ')}`);
    console.log(`[ask]   receipts ${r.receipts.length} · named [${named.map((c) => c.name).join(', ')}] · not-on-record [${notOnRecord.join(', ')}] · missing [${missing.join(', ')}]${t.unknown ? ` · unknown→NO_ANSWER ${unknownOk ? 'yes' : 'NO'}` : ''}${clientPromiseAsMine ? ' · CLIENT PROMISE AS MINE' : ''} → ${bad ? 'INVENTED/UNGROUNDED' : 'grounded'}`);
  }
  console.log(`\n[ask] model ${modelId}: ${invented === 0 ? 'no invented answers' : `${invented} invented/ungrounded answer(s)`} · ${cap.calls} call(s) · AED ${cap.spentAed.toFixed(4)}`);
}

main().catch((err: unknown) => { console.error(`[ask] error: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
