import { describe, it, expect, beforeEach } from 'vitest';
import { RecallService } from './recall-service.js';
import { StructuredRecall } from './structured-recall.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryRecallSessionRepository } from '../../adapters/recall/in-memory-recall-session-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ModelClient } from '../../ports/model.js';
import type { SimilarNote } from '../../ports/note-repository.js';

/**
 * [P21-A2] A follow-up that refers back ("them", "those", "which of them", "the same clients") is limited
 * to the clients the PREVIOUS answer named — it must not re-open the whole book.
 * Retest: "Which clients have I promised to send options to?" → "And which of them wanted parking?"
 * must return QA P14 Gate Client (and not أحمد الحمادي, who asked about parking but was never promised options).
 */
const USER = 'u-a2';
const NOW = Date.parse('2026-10-18T09:00:00Z');
const embedder: Embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };

let clients: InMemoryClientRepository;
let notes: InMemoryNoteRepository;
let svc: RecallService;
let answers: string[];
let ids: { gate: string; sara: string; ahmed: string; enter: string };

beforeEach(async () => {
  clients = new InMemoryClientRepository();
  notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const requirements = new InMemoryRequirementRepository();
  const gate = await clients.create(USER, 'QA P14 Gate Client');
  const sara = await clients.create(USER, 'QA Sara Khan');
  const ahmed = await clients.create(USER, 'أحمد الحمادي');
  const enter = await clients.create(USER, 'QA Enter Key Client');
  ids = { gate: gate.id, sara: sara.id, ahmed: ahmed.id, enter: enter.id };

  const mk = async (clientId: string, extracted: unknown = {}) => {
    const n = await notes.create(USER, { clientId, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted' });
    await notes.update(USER, n.id, { extracted });
    return n.id;
  };
  await facts.saveExtraction(USER, { noteId: await mk(gate.id), clientId: gate.id, promises: [{ text: 'send three villa options', owner: 'rep', due_date: '2026-10-20', due_raw: null, confidence: 'high' }] });
  await facts.saveExtraction(USER, { noteId: await mk(sara.id), clientId: sara.id, promises: [{ text: 'send options for a 2-bed', owner: 'rep', due_date: '2026-10-22', due_raw: null, confidence: 'high' }] });
  await requirements.saveForNote(USER, await mk(gate.id), gate.id, [{ text: 'parking for two cars', requirementRaw: 'need parking for two cars', statedOn: '2026-04-12', confidence: 'high', embedding: null }]);
  await mk(ahmed.id, { unanswered_questions: [{ question: 'can you check if parking is included?', sentAt: '2026-03-02T10:15:00Z', sender: 'أحمد الحمادي' }] });
  await requirements.saveForNote(USER, await mk(enter.id), enter.id, [{ text: 'covered parking', requirementRaw: 'covered parking please', statedOn: '2026-05-01', confidence: 'high', embedding: null }]);

  answers = [];
  const scripted = ['You promised to send options to QA P14 Gate Client (three villa options) and QA Sara Khan (a 2-bed).', 'QA P14 Gate Client wanted parking.'];
  const model: ModelClient = { complete: async () => { const t = scripted[answers.length] ?? 'ok'; answers.push(t); return { text: t }; } };
  const noVector = { searchSimilarByUser: async (): Promise<SimilarNote[]> => [] } as never;
  const structured = new StructuredRecall({ facts, meetings, clients, requirements, notes });
  svc = new RecallService(embedder, noVector, model, { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 5000 },
    undefined, 'stub', new InMemoryRecallSessionRepository(), undefined, undefined,
    async (u) => (await clients.listByUser(u)).map((c) => ({ id: c.id, name: c.name })), undefined, undefined, structured);
});

describe('[P21-A2] follow-ups are scoped to the previous answer\'s clients', () => {
  it('"And which of them wanted parking?" → Gate Client only', async () => {
    await svc.ask(USER, 'Which clients have I promised to send options to?', NOW);
    const { receipts } = await svc.ask(USER, 'And which of them wanted parking?', NOW + 60_000);
    const cids = new Set(receipts.map((r) => r.clientId));
    expect(receipts.some((r) => r.clientId === ids.gate && r.quote.includes('need parking for two cars'))).toBe(true);
    expect(cids.has(ids.ahmed), 'أحمد was not in the previous answer').toBe(false);
    expect(cids.has(ids.enter), 'Enter Key Client was not in the previous answer').toBe(false);
    for (const c of cids) expect([ids.gate, ids.sara]).toContain(c);
  });

  for (const q of ['Which of those asked about parking?', 'Did the same clients want parking?', 'Do they need parking?', 'مين منهم يحتاج موقف؟']) {
    it(`"${q}" is treated as a follow-up`, async () => {
      await svc.ask(USER, 'Which clients have I promised to send options to?', NOW);
      const { receipts } = await svc.ask(USER, q, NOW + 60_000);
      expect(receipts.some((r) => r.clientId === ids.ahmed || r.clientId === ids.enter)).toBe(false);
    });
  }

  it('NEGATIVE: a fresh question (no back-reference) still searches the whole book', async () => {
    await svc.ask(USER, 'Which clients have I promised to send options to?', NOW);
    const { receipts } = await svc.ask(USER, 'Who asked about parking?', NOW + 60_000);
    const cids = new Set(receipts.map((r) => r.clientId));
    expect(cids.has(ids.ahmed)).toBe(true);
    expect(cids.has(ids.gate)).toBe(true);
  });

  it('NEGATIVE: a "them" with no previous answer naming a client is not narrowed to nothing', async () => {
    const { receipts } = await svc.ask(USER, 'Which of them wanted parking?', NOW);
    expect(receipts.some((r) => r.clientId === ids.gate)).toBe(true);
    expect(receipts.some((r) => r.clientId === ids.ahmed)).toBe(true);
  });

  it('NEGATIVE: a shared word ("QA", "Client") in the answer does not pull in every QA client', async () => {
    await svc.ask(USER, 'Which clients have I promised to send options to?', NOW);
    const { receipts } = await svc.ask(USER, 'And which of them wanted parking?', NOW + 60_000);
    expect(receipts.some((r) => r.clientId === ids.enter)).toBe(false);
  });
});
