import { describe, it, expect, beforeEach } from 'vitest';
import { StructuredRecall } from './structured-recall.js';
import { RecallService } from './recall-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ModelClient } from '../../ports/model.js';

/**
 * [P21-A1 / FEAT-05] Cross-client structured source for Ask, beyond promises/meetings/key dates:
 * requirements, people, personal facts and unanswered client questions — matched against the question
 * in English AND Arabic, each row keeping its receipt (quote naming the client, date, source note).
 * Scenario from the 18 Oct retest: "who asked about parking?" must return BOTH clients.
 */
const USER = 'u-a1';
const NOW = Date.parse('2026-10-18T09:00:00Z');

let clients: InMemoryClientRepository;
let facts: InMemoryFactsRepository;
let meetings: InMemoryMeetingRepository;
let notes: InMemoryNoteRepository;
let requirements: InMemoryRequirementRepository;
let structured: StructuredRecall;

async function chatNote(clientId: string, extracted: Record<string, unknown>, status = 'extracted') {
  const n = await notes.create(USER, { clientId, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status });
  await notes.update(USER, n.id, { extracted });
  return n;
}

let gate: { id: string };
let ahmed: { id: string };
let sara: { id: string };
let gateNoteId: string;
let ahmedNoteId: string;

beforeEach(async () => {
  clients = new InMemoryClientRepository();
  facts = new InMemoryFactsRepository();
  meetings = new InMemoryMeetingRepository();
  notes = new InMemoryNoteRepository();
  requirements = new InMemoryRequirementRepository();
  structured = new StructuredRecall({ facts, meetings, clients, requirements, notes });

  gate = await clients.create(USER, 'QA P14 Gate Client');
  ahmed = await clients.create(USER, 'أحمد الحمادي');
  sara = await clients.create(USER, 'QA Sara Khan');

  const gateNote = await chatNote(gate.id, {});
  gateNoteId = gateNote.id;
  await requirements.saveForNote(USER, gateNote.id, gate.id, [
    { text: 'parking for two cars', requirementRaw: 'need parking for two cars', statedOn: '2026-04-12', confidence: 'high', embedding: null },
  ]);
  const saraNote = await chatNote(sara.id, {});
  await requirements.saveForNote(USER, saraNote.id, sara.id, [
    { text: 'a sea view', requirementRaw: 'must have a sea view', statedOn: '2026-03-20', confidence: 'high', embedding: null },
  ]);
  const ahmedNote = await chatNote(ahmed.id, {
    unanswered_questions: [{ question: 'can you check if parking is included?', sentAt: '2026-03-02T10:15:00.000Z', sender: 'أحمد الحمادي' }],
    people: [{ name: 'منى', role: 'زوجته', reports_to: null, decision_role: 'influencer', notes: 'تهتم بالمدارس', source_span: 'زوجتي منى تهتم بالمدارس', source_message_at: '2026-03-02T10:20:00.000Z' }],
    personal_facts: [{ subject: 'Ahmed', fact: 'daughter starts school in September', category: 'family', source_span: 'my daughter starts school in September', source_message_at: '2026-03-03T08:00:00.000Z' }],
  });
  ahmedNoteId = ahmedNote.id;
});

describe('[P21-A1] structured source: requirements, people, personal facts, unanswered questions', () => {
  it('"who asked about parking?" returns BOTH clients, each with its receipt', async () => {
    const receipts = await structured.forUser(USER, NOW, { question: 'who asked about parking?' });
    const gateR = receipts.find((r) => r.clientId === gate.id);
    const ahmedR = receipts.find((r) => r.clientId === ahmed.id);
    expect(gateR, 'Gate Client requirement').toBeDefined();
    expect(gateR!.quote).toContain('QA P14 Gate Client');
    expect(gateR!.quote).toContain('need parking for two cars'); // verbatim requirement phrase
    expect(gateR!.date).toBe('2026-04-12');
    expect(gateR!.noteId).toBe(gateNoteId);
    expect(ahmedR, 'أحمد الحمادي unanswered question').toBeDefined();
    expect(ahmedR!.quote).toContain('أحمد الحمادي');
    expect(ahmedR!.quote).toContain('can you check if parking is included?');
    expect(ahmedR!.date).toBe('2026-03-02'); // the MESSAGE day, not the import day
    expect(ahmedR!.noteId).toBe(ahmedNoteId);
    // Matched rows only — Sara's unrelated sea-view need is not dragged in.
    expect(receipts.some((r) => r.quote.includes('sea view'))).toBe(false);
  });

  it('matches Arabic: an Arabic question finds an Arabic person row (article/prefix-insensitive)', async () => {
    const receipts = await structured.forUser(USER, NOW, { question: 'من هي منى؟' });
    const r = receipts.find((x) => x.quote.includes('منى'));
    expect(r, 'Arabic person row').toBeDefined();
    expect(r!.clientId).toBe(ahmed.id);
    expect(r!.date).toBe('2026-03-02');
    const r2 = await structured.forUser(USER, NOW, { question: 'مين مهتم بالمدارس' });
    expect(r2.some((x) => x.quote.includes('تهتم بالمدارس'))).toBe(true); // بالمدارس ↔ بالمدارس / المدارس
  });

  it('matches personal facts', async () => {
    const receipts = await structured.forUser(USER, NOW, { question: "whose daughter is starting school?" });
    const r = receipts.find((x) => x.quote.includes('daughter starts school in September'));
    expect(r).toBeDefined();
    expect(r!.quote).toContain('أحمد الحمادي');
    expect(r!.date).toBe('2026-03-03');
  });

  it('matches requirements in either direction of inflection ("parked" / "parking", "cars" / "car")', async () => {
    const receipts = await structured.forUser(USER, NOW, { question: 'anyone need space for a car?' });
    expect(receipts.some((r) => r.clientId === gate.id && r.quote.includes('parking for two cars'))).toBe(true);
  });

  it('NEGATIVE: a pending (unconfirmed) Ask-capture note never feeds the structured source', async () => {
    await chatNote(sara.id, { unanswered_questions: [{ question: 'is parking free?', sentAt: '2026-05-01T09:00:00Z', sender: 'Sara' }] }, 'pending_confirmation');
    const receipts = await structured.forUser(USER, NOW, { question: 'who asked about parking?' });
    expect(receipts.some((r) => r.quote.includes('is parking free?'))).toBe(false);
  });

  it('NEGATIVE: a question with no content words adds no requirement/people/fact rows (digest only)', async () => {
    const receipts = await structured.forUser(USER, NOW, { question: 'who?' });
    expect(receipts.some((r) => /needs:|asked:/.test(r.quote))).toBe(false);
  });

  it('NEGATIVE: a met requirement is not surfaced as an open need', async () => {
    const [req] = await requirements.listByClient(USER, gate.id);
    await requirements.setStatus(USER, req!.id, 'met');
    const receipts = await structured.forUser(USER, NOW, { question: 'who asked about parking?' });
    expect(receipts.some((r) => r.quote.includes('need parking for two cars'))).toBe(false);
  });
});

describe('[P21-A1] RecallService puts question-matched structured rows ahead of the budget cut', () => {
  it('"who asked about parking?" via Ask returns receipts for both clients even when vector notes fill the budget', async () => {
    const embedder: Embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };
    const model: ModelClient = { complete: async () => ({ text: 'QA P14 Gate Client and أحمد الحمادي asked about parking.' }) };
    // A vector source that returns a long irrelevant note — it would eat a small token budget first.
    const long = await notes.create(USER, { clientId: sara.id, source: 'paste', rawText: 'x '.repeat(900), audioKey: null, status: 'extracted' });
    const vectorNotes = { searchSimilarByUser: async () => [{ note: (await notes.findByIdForUser(USER, long.id))!, similarity: 0.9 }] } as never;
    const svc = new RecallService(embedder, vectorNotes, model, { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 300 },
      undefined, 'stub', undefined, undefined, undefined, undefined, undefined, undefined, structured);
    const { receipts } = await svc.ask(USER, 'who asked about parking?', NOW);
    const ids = new Set(receipts.map((r) => r.clientId));
    expect(ids.has(gate.id)).toBe(true);
    expect(ids.has(ahmed.id)).toBe(true);
  });
});
